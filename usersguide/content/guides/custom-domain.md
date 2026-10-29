---
title: Use your own domain
description: Add a domain and certificate after the default CloudFront deployment works.
---

A domain is optional. Start with the default CloudFront hostname from
[deployment](../getting-started/deployment.md), then attach your own name when
you need it.

## The existing custom website template

For the authentication-disabled website, the framework includes
`resources-custom-website.yml`. It expects these configuration values:

```yaml
custom:
  domain: example.com
  hostedZoneName: example.com.
  domainName: app.example.com
  certificateARN: arn:aws:acm:us-east-1:YOUR-ACCOUNT:certificate/YOUR-CERTIFICATE
```

Keep the tutorial's other custom values, and replace its website resource include:

```yaml
resources:
  - ${file(${self:custom.yml}/resources-custom-website.yml)}
  - ${file(${self:custom.yml}/resources-dynamodb.yml)}
```

The template configures CloudFront aliases, the viewer certificate and a Route 53
alias record in your hosted zone. CloudFront certificates must be in `us-east-1`
and cover the chosen hostname. You supply the hosted zone and issued certificate;
the template does not register a domain or issue a certificate for you.
See [AWS's CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

## Authenticated websites

There is no separate authenticated custom-domain include. The existing legacy
custom-domain template does not forward Authorization or preserve API 403 errors
as required by the authenticated deployment.

The HTTP/socket function configuration does not change with the website domain:
continue using `functions-authenticated.yml`. The missing convenience include
would be a **website resource** file, such as
`resources-custom-website-authenticated.yml`, rather than another function file.

For now, copy `resources-website-authenticated.yml` into your application's
configuration directory and make these changes:

1. In `CloudFrontDistribution.Properties.DistributionConfig`, replace the default
   `ViewerCertificate` with your ACM certificate settings and add `Aliases` for
   the website hostname. Remove `CloudFrontDefaultCertificate`; it must not remain
   alongside the ACM certificate configuration.
2. Add a Route 53 alias record pointing that hostname at the distribution, using
   the `CustomDNSName` resource in `resources-custom-website.yml` as the pattern.
   Keep the existing distribution and bucket logical IDs so those references
   still identify the intended resources.
3. Replace only the website resource include in the service configuration with
   your application-owned file. Keep the authenticated functions and session-table
   includes. Set the hosted-zone, hostname and certificate values described above.

Preserve the authenticated template's API behavior: disabled API caching,
`AllViewerExceptHostHeader` forwarding and no conversion of API 403 errors into
an HTML page with HTTP 200. That origin-request policy forwards Authorization but
replaces the viewer's custom-domain Host header with the API origin's hostname,
which API Gateway expects. Do not copy the legacy template's `ForwardedValues`
or its 403-to-200 rewrite into the authenticated configuration. See
[AWS's managed origin-request policy documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html#managed-origin-request-policy-allviewerexcepthostheader).

The CloudFront website alias does not require a custom domain for the HTTP API
origin or WebSocket API. Keep `APIG_ENDPOINT` pointing to the framework's
WebSocket API/stage. Register the custom website's exact login return and logout
return URLs with the identity provider, and use the same login return URL in the
client's managed configuration. For a callback at an arbitrary SPA path, deploy
that page or configure an explicit routing mechanism; the authenticated template
does not turn S3 403 errors into an SPA fallback.


The [Serverless reference](../reference/serverless.md) lists the supplied templates
and their intended uses.
