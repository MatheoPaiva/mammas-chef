# Contributing to Mamma's Chef

Thanks for wanting to help. This is a small project, so the process is light.

## Get it running

Follow the [Install](README.md#install) and [Run it](README.md#run-it) sections of the README. You need Node.js 20 or newer and Docker Desktop running.

## Tests and lint

Run these before you open a pull request:

```sh
npm test                                                        # frontend tests
deno test --allow-env --allow-net --allow-read supabase/functions/_shared  # AI function tests
npm run lint
```

The `deno` command needs [Deno](https://deno.com) installed.

## Proposing a change

- **Small fixes** (typos, a clear bug with an obvious fix, docs): open a pull request straight away.
- **Anything bigger** (a new feature, a schema change, a change to how plans are generated): open an issue first so we can agree on the approach before you spend time on it.
- **Questions and ideas**: use [GitHub Discussions](https://github.com/PreillySMP/mammas-chef/discussions).

## Pull request expectations

- Keep each pull request to one change, and say what it does and why in the description.
- Make sure `npm test` and `npm run lint` pass.
- Update the README if you change a command, setting or setup step.
- Never commit your `supabase/functions/.env` file or any API keys.

## Where to start

Look for issues labelled [`good first issue`](https://github.com/PreillySMP/mammas-chef/labels/good%20first%20issue). They are small and have enough context to get going.

This project is maintained when time allows, so reviews may take a while. Thanks for your patience.
