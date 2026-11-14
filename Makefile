
.PHONY: build test comments comments-test hooks

build:
	cd typescript && npm install --no-audit --no-fund --loglevel=error && npm run build

test: build comments
	cd typescript && npm test
	git diff --exit-code -- typescript/dist || { echo "typescript/dist is stale: commit it with its source" >&2; exit 1; }

comments:
	node tools/comment-gate.cjs

comments-test:
	node --test tools/comment-gate.test.cjs

hooks:
	git config core.hooksPath .githooks
