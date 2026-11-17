
.PHONY: build link test comments comments-test hooks

# The tests run against a station checkout, which carries the extension
# points this package needs ahead of their release: STATION_HOME, else
# a sibling ../station. The link lives in the ignored node_modules.
STATION := $(shell for d in "$$STATION_HOME" ../station; do \
  if [ -n "$$d" ] && [ -f "$$d/typescript/package.json" ]; then cd "$$d" && pwd; break; fi; done)

build:
	cd typescript && npm install --no-audit --no-fund --loglevel=error
	$(MAKE) link
	cd typescript && npm run build

link:
	@test -n "$(STATION)" || { echo "station-view: no voxgig/station checkout - set STATION_HOME" >&2; exit 1; }
	@test -f "$(STATION)/typescript/dist/src/index.js" || { echo "station-view: build $(STATION)/typescript first" >&2; exit 1; }
	mkdir -p typescript/node_modules/@voxgig
	rm -rf typescript/node_modules/@voxgig/station
	ln -s "$(STATION)/typescript" typescript/node_modules/@voxgig/station

test: build comments
	cd typescript && npm test
	git diff --exit-code -- typescript/dist || { echo "typescript/dist is stale: commit it with its source" >&2; exit 1; }

comments:
	node tools/comment-gate.cjs

comments-test:
	node --test tools/comment-gate.test.cjs

hooks:
	git config core.hooksPath .githooks
