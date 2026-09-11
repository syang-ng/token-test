.PHONY: install build test simulate deploy resume simulate-good-token deploy-good-token verify-good-token

install:
	forge install --no-git --shallow OpenZeppelin/openzeppelin-contracts@v5.0.2 foundry-rs/forge-std@v1.9.7

build:
	forge build

test:
	forge test -vv
	node --test scripts/deploy.test.mjs

simulate:
	node scripts/deploy.mjs simulate

deploy:
	node scripts/deploy.mjs deploy

resume:
	node scripts/deploy.mjs resume

simulate-good-token:
	node scripts/deploy-good-token.mjs simulate

deploy-good-token:
	node scripts/deploy-good-token.mjs deploy

verify-good-token:
	node scripts/deploy-good-token.mjs verify
