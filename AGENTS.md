# x-copilot

## Code comments

Do not write comments in code you patch. No block comments, no line comments, no JSDoc, no TODO notes. Do not replace a comment with a shorter one.

Agents read this source. Names, types, and tests carry the meaning. A comment that explains a change, a workaround, or a ticket belongs in the commit, the issue, or the PR.

Delete a comment only inside a function you are already changing, and only once a test or a function name states that rule. If the comment is the only place the rule exists, add the test or the rename in the same change, then delete the comment. Otherwise leave it.

Do not strip every comment in a file because you edited it. Do not open a file only to strip comments.

Leave lint and type directives, generated-file banners, and legal notices.

This applies to TypeScript, JavaScript, SQL, and shell. It does not apply to Markdown, prompt strings, or user-facing copy.
