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

For authenticated hosting, start from `resources-website-authenticated.yml` and
maintain an application-owned copy with the aliases, ACM viewer certificate and
DNS record added. Preserve its disabled API caching, Authorization forwarding and
error behavior. Register the resulting login/logout URLs with your provider.

Custom-domain behavior has not been part of the framework's deployed acceptance
matrix. Validate your own DNS, TLS, callback and API behavior before relying on
that configuration. The [Serverless reference](../reference/serverless.md) lists
the supplied templates and their intended uses.
