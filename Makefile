.PHONY: test test-watch npm fmt clean bundle

clean:
	rm -rf npm build .nyc_output coverage earthstar.bundle.js cov.lcov coverage_html cov_profile node_modules

example:
	deno run ./example-app.ts

test:
	deno test src

test-watch:
	deno test --watch src

test-coverage:
	deno test --no-check --coverage=cov_profile src

# to get "genhtml", run "sudo apt-get install lcov" (on linux) or "brew install lcov" (on mac)
show-coverage:
	deno coverage cov_profile --lcov > cov.lcov && genhtml -o cov_html cov.lcov

coverage: test-coverage show-coverage

npm:
	deno run --allow-all scripts/build_npm.ts $(VERSION)

fmt:
	deno fmt --options-indent-width=4 --options-line-width=100 src/ scripts/
	
bundle:
	deno bundle --no-check=remote ./mod.ts ./earthstar.bundle.js
	
run-bundle:
	deno run --allow-all ./earthstar.bundle.js --help

depchart-no-types:
	mkdir -p depchart && npx depchart `find src | grep .ts` --exclude deps.ts src/print-platform-support.ts src/decls.d.ts src/index.ts src/index.browser.ts src/shims/*.ts src/entries/*.ts `find src | grep '/test/'` `find src | grep '/util/'` `find src | grep '/experimental/'` `find src | grep types.ts` --rankdir LR -o depchart/depchart-no-types --node_modules omit

depchart-deps:
	mkdir -p depchart && npx depchart deps.ts `find src | grep .ts` --exclude src/print-platform-support.ts src/decls.d.ts src/index.ts src/index.browser.ts src/shims/*.ts src/entries/*.ts `find src | grep '/test/'` `find src | grep '/util/'` `find src | grep '/experimental/'` --rankdir LR -o depchart/depchart-deps --node_modules separated

depchart: depchart-no-types depchart-deps
