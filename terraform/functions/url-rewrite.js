// CloudFront Function (viewer request): clean URLs for a static site on a
// private S3 bucket. S3's REST endpoint has no folder index pages, so:
//   /posts/my-slug/  -> fetches posts/my-slug/index.html (URL stays clean)
//   /posts/my-slug   -> 301 redirect to /posts/my-slug/  (one URL per page)
// Paths whose last segment has a dot (e.g. /sitemap.xml, /robots.txt) pass through.
// Query strings are dropped on the redirect; the cache ignores them anyway.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri + '/' } },
    };
  }

  return request;
}
