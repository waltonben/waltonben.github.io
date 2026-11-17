# RipKit

A Chrome extension for finding fonts, images, SVGs and brand styles on webpages.

## Publish the download page

1. Upload the contents of this folder to the root of your GitHub repository.
2. In the repository, open Settings → Pages.
3. Choose Deploy from a branch. Select your default branch and the /docs folder, then save.
4. Use the site address displayed under Settings → Pages.

The docs folder contains the landing page, icon and downloadable extension ZIP. The extension folder contains the same build in unpacked form, with manifest.json at its root.

On a GitHub Pages project URL, the page links to the repository automatically. On a custom domain or in a local preview, the source link downloads the extension ZIP. To use a repository link on a custom domain, set the source anchor’s href in docs/index.html to the repository URL and remove its download attribute.

For a new release, replace docs/RipKit-Chrome.zip and the extension folder, then update the version shown in docs/index.html.
