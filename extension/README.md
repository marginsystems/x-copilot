# XCoPilot browser extension

The extension displays your approach card beside X, keeps your desk in sync with
published posts, and provides a local reading timer. It never types or posts for
you. A signed-in XCoPilot account and agreement to the extension data disclosure
on Account are required to connect it.

## Reproduce the Firefox package

The source ZIP contains `extension/` and `shared/src/`. Use Node.js 22.23.0 and npm
10.9.8. The build runs locally with public npm dependencies and requires no API
keys, account credentials, or environment file. From the extracted ZIP root:

```sh
cd extension
npm ci
npm run build:firefox
```

The generated extension is in `extension/.output/firefox-mv2/`. Compare this
directory with the contents of the submitted Firefox ZIP. The lockfile fixes the
dependency versions. `npm ci` also runs `wxt prepare` to generate build types.
Linux, macOS, and Windows are supported build environments.

To generate packages and a matching source archive:

```sh
npm run zip
npm run zip:firefox
```

The outputs are `x-copilot-<version>-chrome.zip`,
`x-copilot-<version>-firefox.zip`, and `x-copilot-<version>-sources.zip` under
`extension/.output/`. Upload the Chrome ZIP to the Chrome Web Store. Upload the
Firefox ZIP and its matching source ZIP to Mozilla Add-ons.

## Browser support and consent

The release targets desktop Chrome 114+ and desktop Firefox 140+. Firefox uses
Manifest V2 and its sidebar API; Chrome uses Manifest V3 and its side-panel API.
Firefox Android is not a supported release target. Its minimum version is set to
142 so that any installation also has built-in data consent; select desktop-only
compatibility when submitting to Mozilla Add-ons.

Firefox declares authentication information for the extension token, browsing
activity for X post URLs and IDs, website content and personal communications for
public post text, and website activity for reply detection and card choices.
The extension does not load remote executable code or send local reading-timer
progress to the server. The bundled React runtime contains `innerHTML` helpers
that may produce validator warnings; the application does not use
`dangerouslySetInnerHTML`.

The privacy policy is at <https://xcopilot.dev/privacy>. Before connecting from
Account, users see the data disclosure and must explicitly agree. Sign out in
the extension to disconnect; account session controls can revoke an extension
session on the server.

## Review the account-dependent workflow

Provide reviewer account access through the stores’ private test-instruction
fields. Do not put credentials in this source archive or public listing.

1. Install the package, then open the extension toolbar button.
2. Sign in at <https://xcopilot.dev> and open Account.
3. Read the disclosure, select the agreement checkbox, and click Connect extension.
4. Open X and verify the approach card appears in the sidebar or side panel.
5. Verify Next, Skip, Not interested, published-post detection, and sign-out.

The `storage` permission keeps pairing and settings locally. `tabs` reuses open
X and XCoPilot tabs. Chrome’s `sidePanel` permission displays the approach card.
Host access is limited to X and the XCoPilot API, with desk content scripts on
the two XCoPilot domains. Localhost access is included only in development.
