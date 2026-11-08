// build-minimal-workflow.js
// Generates n8n/workflows/publish-post-minimal.json from the repo's template,
// renderer and sample post, so the code inside n8n always matches templates/.
// Usage: node n8n/build-minimal-workflow.js
// Then in n8n: Workflows → Import from File → pick the generated JSON.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'templates/post.html'), 'utf8');
const renderSource = fs.readFileSync(path.join(root, 'templates/render.js'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'templates/sample-post.json'), 'utf8'));

// Keep only the functions: drop the module.exports / command-line tail.
const cut = renderSource.indexOf('if (typeof module');
if (cut === -1) throw new Error('render.js: could not find the module/CLI section to strip');
const renderFunctions = renderSource.slice(0, cut).replace("'use strict';\n", '');

// Bucket, distribution and site URL come from Terraform's outputs (read from
// local state; no AWS calls), so a destroy + re-apply can't leave stale IDs here.
// Not secret; the AWS credential is attached in n8n.
const { execFileSync } = require('child_process');
let tf;
try {
  tf = JSON.parse(execFileSync('terraform', ['-chdir=' + path.join(root, 'terraform'), 'output', '-json'], { encoding: 'utf8' }));
} catch (err) {
  throw new Error(`Could not read Terraform outputs (has terraform apply run?): ${err.message}`);
}
for (const k of ['bucket_name', 'cloudfront_distribution_id', 'site_url']) {
  if (!tf[k]) throw new Error(`Terraform output "${k}" is missing`);
}
const settings = {
  bucket: tf.bucket_name.value,
  distributionId: tf.cloudfront_distribution_id.value,
  site: { ...sample.site, url: tf.site_url.value },
};

const postDataCode = `// Hard-coded post for the minimal workflow.
// Later this node is replaced by a Google Sheets read of the content calendar.
const settings = ${JSON.stringify(settings, null, 2)};

const post = ${JSON.stringify(sample.post, null, 2)};

return [{ json: { settings, post } }];
`;

const renderCode = `// Fills templates/post.html with the post and returns the page as a binary file.
// Generated from templates/render.js by n8n/build-minimal-workflow.js; edit those, not this.
const TEMPLATE = ${JSON.stringify(template)};

${renderFunctions}
const results = [];
for (const item of $input.all()) {
  const { settings, post } = item.json;
  const html = render(TEMPLATE, post, settings.site);
  results.push({
    json: {
      slug: post.slug,
      title: post.title,
      key: \`posts/\${post.slug}/index.html\`,
      url: \`\${settings.site.url}/posts/\${post.slug}/\`,
      bucket: settings.bucket,
      distributionId: settings.distributionId,
      bytes: Buffer.byteLength(html, 'utf8'),
    },
    // The S3 node uses this mimeType as the object's Content-Type.
    binary: {
      data: {
        data: Buffer.from(html, 'utf8').toString('base64'),
        mimeType: 'text/html; charset=utf-8',
        fileName: 'index.html',
        fileExtension: 'html',
      },
    },
  });
}
return results;
`;

const invalidationBody = `=<?xml version="1.0" encoding="UTF-8"?>
<InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/">
  <Paths>
    <Quantity>1</Quantity>
    <Items><Path>/posts/{{ $('Render HTML').item.json.slug }}/*</Path></Items>
  </Paths>
  <CallerReference>n8n-{{ $execution.id }}-{{ $now.toMillis() }}</CallerReference>
</InvalidationBatch>`;

const node = (name, type, typeVersion, x, parameters, extra = {}) => ({
  parameters, name, type, typeVersion, position: [x, 300], id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...extra,
});

const nodes = [
  node('Start', 'n8n-nodes-base.manualTrigger', 1, 0, {}),
  node('Post data', 'n8n-nodes-base.code', 2, 220, { jsCode: postDataCode }),
  node('Render HTML', 'n8n-nodes-base.code', 2, 440, { jsCode: renderCode }),
  node('Upload to S3', 'n8n-nodes-base.awsS3', 2, 660, {
    resource: 'file',
    operation: 'upload',
    bucketName: "={{ $json.bucket }}",
    fileName: "={{ $json.key }}",
    binaryData: true,
    binaryPropertyName: 'data',
    additionalFields: {},
  }),
  node('Invalidate cache', 'n8n-nodes-base.httpRequest', 4.2, 880, {
    method: 'POST',
    url: "=https://cloudfront.amazonaws.com/2020-05-31/distribution/{{ $('Render HTML').item.json.distributionId }}/invalidation",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'aws',
    // CloudFront is global and must be signed for us-east-1; n8n's AWS credential
    // reads this special query parameter as the signing region and removes it.
    sendQuery: true,
    queryParameters: { parameters: [{ name: '_region', value: 'us-east-1' }] },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/xml',
    body: invalidationBody,
    options: {},
  }),
  node('Wait for cache', 'n8n-nodes-base.wait', 1.1, 1100, { amount: 20, unit: 'seconds' }, { webhookId: 'publish-post-minimal-wait' }),
  node('Check live page', 'n8n-nodes-base.httpRequest', 4.2, 1320, {
    url: "={{ $('Render HTML').item.json.url }}",
    options: { response: { response: { fullResponse: true, neverError: true } } },
  }),
  node('Is it live?', 'n8n-nodes-base.if', 2.2, 1540, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        { id: 'status-200', leftValue: '={{ $json.statusCode }}', rightValue: 200,
          operator: { type: 'number', operation: 'equals' } },
        // For text/HTML responses n8n puts the page in "data" (not "body") even with fullResponse.
        { id: 'has-canonical', leftValue: '={{ $json.data }}', rightValue: "={{ $('Render HTML').item.json.url }}",
          operator: { type: 'string', operation: 'contains' } },
      ],
      combinator: 'and',
    },
    options: {},
  }),
  node('Published', 'n8n-nodes-base.code', 2, 1760, {
    jsCode: "const p = $('Render HTML').first().json;\nreturn [{ json: { published: true, url: p.url, key: p.key, bytes: p.bytes } }];\n",
  }),
  node('Not live', 'n8n-nodes-base.stopAndError', 1, 1760, {
    errorMessage: "=Page did not come back correctly: HTTP {{ $json.statusCode }} for {{ $('Render HTML').item.json.url }}",
  }),
];
nodes.find((n) => n.name === 'Published').position = [1760, 200];
nodes.find((n) => n.name === 'Not live').position = [1760, 400];

const chain = ['Start', 'Post data', 'Render HTML', 'Upload to S3', 'Invalidate cache', 'Wait for cache', 'Check live page', 'Is it live?'];
const connections = {};
for (let i = 0; i < chain.length - 1; i++) {
  connections[chain[i]] = { main: [[{ node: chain[i + 1], type: 'main', index: 0 }]] };
}
connections['Is it live?'] = {
  main: [
    [{ node: 'Published', type: 'main', index: 0 }],
    [{ node: 'Not live', type: 'main', index: 0 }],
  ],
};

const workflow = {
  name: 'Publish post (minimal)',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = path.join(__dirname, 'workflows', 'publish-post-minimal.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Wrote ${path.relative(root, out)}`);
