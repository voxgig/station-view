# patch/

Work that nobody has applied yet. A session cannot push a change under
`.github/workflows/`, so the change arrives here as a `git format-patch`
file, for a maintainer to apply.

| patch | touches | why |
| --- | --- | --- |
| `0001-W10.2-CI-runs-make-test-on-Node-22-and-24-the-page-t.patch` | adds `.github/workflows/test.yml` | CI runs `make test` on Node 22 and 24, with Playwright and Chromium outside the package, so the page test runs rather than skips (W10.2 in voxgig/station's plan) |

Apply it on `main`, then delete this folder: once applied, the patch only
duplicates the history it created.

```sh
git am < patch/0001-W10.2-CI-runs-make-test-on-Node-22-and-24-the-page-t.patch
git rm -r patch
git commit -m "Remove the applied CI patch"
git push origin main
```

`git apply --check patch/0001-W10.2-CI-runs-make-test-on-Node-22-and-24-the-page-t.patch` says first whether it still applies.
