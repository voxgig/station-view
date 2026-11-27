# Agent guide

station-view is a plugin for [voxgig/station](https://github.com/voxgig/station):
station loads it when a caller hands it the definition, and never otherwise.
It follows station's family layout: one directory per language, TypeScript
canonical. Only `typescript/` exists so far.

It switches sdkgen's `telemetry`, `debug`, `audit` and `metrics` features on in
each SDK a Station builds, through station's `sdk.feature` point and its
`withfeature` helper, and collects what they report beside the Station's own
events. It serves a page and a read-only JSON API on loopback. Three rules hold
it together, and each has a test that fails without it:

- an SDK is never handed a feature it was not generated with;
- the server answers only a loopback `Host`, so a page elsewhere cannot rebind
  a name onto it;
- everything the server writes passes through the Station's `redact()`.

The page's script runs under a per-response nonce and writes values as text,
never as markup.

Its tests run against npm's station, 0.4.0 or later, the first release that
carries station's extension points.

## Building and testing

```sh
make test      # build the typescript package, run its tests, check dist/ is fresh
make comments  # the comment gate
```

`typescript/dist/` is committed, as the generated SDKs commit theirs, so a
consumer can take the package from a checkout with no build step. A change to
`typescript/src/` is not done until `make build` has been run and `dist/`
committed with it; `make test` fails on a stale `dist/`.

## Source code comments

Follow [COMMENT-POLICY.md](COMMENT-POLICY.md): comments are sparse and terse,
only for intricate or surprising code. Names carry intent; documents carry
requirements. Run `make comments comments-test` after editing source.
