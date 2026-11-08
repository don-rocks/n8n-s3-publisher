// build-common.js
// Shared pieces for the workflow build scripts: Terraform outputs, the template,
// the renderer's functions and small helpers for writing n8n workflow JSON.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', '..');

// Bucket, distribution and site URL come from Terraform's outputs (read from
// local state; no AWS calls), so a destroy + re-apply can't leave stale IDs.
function terraformOutputs() {
  let tf;
  try {
    tf = JSON.parse(execFileSync('terraform', ['-chdir=' + path.join(root, 'terraform'), 'output', '-json'], { encoding: 'utf8' }));
  } catch (err) {
    throw new Error(`Could not read Terraform outputs (has terraform apply run?): ${err.message}`);
  }
  for (const k of ['bucket_name', 'cloudfront_distribution_id', 'site_url']) {
    if (!tf[k]) throw new Error(`Terraform output "${k}" is missing`);
  }
  return {
    bucket: tf.bucket_name.value,
    distributionId: tf.cloudfront_distribution_id.value,
    siteUrl: tf.site_url.value,
  };
}

function readRepoFile(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// render.js without its module.exports / command-line tail, for pasting into a Code node.
function renderFunctions() {
  const src = readRepoFile('templates/render.js');
  const cut = src.indexOf('if (typeof module');
  if (cut === -1) throw new Error('render.js: could not find the module/CLI section to strip');
  return src.slice(0, cut).replace("'use strict';\n", '');
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return {
    parameters, name, type, typeVersion, position,
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...extra,
  };
}

// connect(connections, from, to, outputIndex) adds one main connection.
function connect(connections, from, to, output = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
}

function writeWorkflow(fileName, workflow) {
  const out = path.join(root, 'n8n', 'workflows', fileName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, out)}`);
}

// CloudFront invalidation request, signed for us-east-1 via n8n's _region override
// (CloudFront is global; n8n would otherwise sign with the credential's region).
function invalidateNode(name, position, slugExpr, distributionIdExpr) {
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: `=https://cloudfront.amazonaws.com/2020-05-31/distribution/{{ ${distributionIdExpr} }}/invalidation`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'aws',
    sendQuery: true,
    queryParameters: { parameters: [{ name: '_region', value: 'us-east-1' }] },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/xml',
    body: `=<?xml version="1.0" encoding="UTF-8"?>
<InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/">
  <Paths>
    <Quantity>1</Quantity>
    <Items><Path>/posts/{{ ${slugExpr} }}/*</Path></Items>
  </Paths>
  <CallerReference>n8n-{{ $execution.id }}-{{ ${slugExpr} }}-{{ $now.toMillis() }}</CallerReference>
</InvalidationBatch>`,
    options: {},
  });
}

// Live check: n8n puts an HTML response's text in "data" (not "body") even with fullResponse.
function liveCheckNodes(checkName, ifName, x, urlExpr) {
  return [
    node(checkName, 'n8n-nodes-base.httpRequest', 4.2, [x, 300], {
      url: `={{ ${urlExpr} }}`,
      options: { response: { response: { fullResponse: true, neverError: true } } },
    }),
    node(ifName, 'n8n-nodes-base.if', 2.2, [x + 220, 300], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [
          { id: 'status-200', leftValue: '={{ $json.statusCode }}', rightValue: 200,
            operator: { type: 'number', operation: 'equals' } },
          { id: 'has-canonical', leftValue: '={{ $json.data }}', rightValue: `={{ ${urlExpr} }}`,
            operator: { type: 'string', operation: 'contains' } },
        ],
        combinator: 'and',
      },
      options: {},
    }),
  ];
}

module.exports = {
  root, terraformOutputs, readRepoFile, renderFunctions, node, connect, writeWorkflow,
  invalidateNode, liveCheckNodes,
};
