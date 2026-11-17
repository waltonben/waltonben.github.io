# RipKit for Chrome

A local Manifest V3 extension for discovering website font files, previewing custom text and downloading individual fonts. No server, account, API key or build tools are needed.

## Install via Developer mode

1. Extract `RipKit-Chrome.zip`.
2. Keep the extracted `Font-Scout-Chrome` folder somewhere permanent on your computer.
3. In Google Chrome, open `chrome://extensions`.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the folder containing `manifest.json`.
6. Open Chrome's extensions menu (the puzzle icon) and pin **RipKit**.

Do not open dashboard.html directly. Chrome must load the extension through its Extensions page. Keep the folder in place while the extension is installed. If you change its files, click Reload on the extension's card.

## Scan a page

1. Open the website you want to inspect.
2. Click the RipKit toolbar icon. Its dashboard opens in a new tab, linked to the original website tab.
3. Click **Scan selected tab**. On your first scan, allow the requested website access.
4. Type into **Your preview text** and change the size slider to compare fonts.
5. Click **Download font family ZIP** for one family or **Download all fonts ZIP** for all families.

For a new address, enter it and click **Open URL & scan**. The extension opens that website in a separate background tab and inspects it. CSS and font URLs can also be entered directly.

### Capture fonts from network requests

RipKit reads existing stylesheets, accessible open shadow roots, preloads and Resource Timing entries. It observes new font requests while the scan runs.

For content that loads after scrolling or interaction, visit that content in the source tab, then click the RipKit toolbar icon again. The scan is not a crawl of every page on a website.

## Toolbar and sitemap scans

Click the toolbar icon on a website to scan its current tab automatically. Chrome may ask you to allow website access on first use. If access is declined, you can start from the dashboard when ready.

Use **Check sitemap** and then **Scan entire site** to inspect the published HTML and stylesheets of the same-origin URLs in /sitemap.xml, including nested sitemap indexes. The scan combines duplicate asset URLs. It does not execute each page’s JavaScript, so use the toolbar scan for assets added by scripts. The Brand tab is populated by a single-page scan.

The Fonts tab groups named fonts by family. Pick a weight or style to preview it. The family ZIP contains the available TTF and OTF exports for that family, including separate character subsets. The bulk button saves all families in one ZIP.

## Images and brand reports

After scanning a page, switch between **Fonts**, **Images** and **Brand**. Images includes previews, pixel dimensions, file size, file type and a save button per asset. The scanner looks for page images, CSS image URLs, loaded image requests and inline SVG. **Download all images ZIP** saves the available image files. A raster-only SVG containing one embedded image exports that raster payload in its declared format. This extracts the source image, including pixels outside any SVG crop. Mixed vector and raster artwork stays SVG and shows the embedded format in its label. Inline SVG exports keep common computed paint styles. Vectors that depend on external SVG symbols, fonts or artwork may differ from their appearance on the page.

Brand reports use the current page and viewport. They show H1–H6 and common text styles, CSS font stacks, sizes, weights, line heights, observed colours and button styles. Primary and secondary roles are inferred when the page does not label them. Click **Export A4 PDF**, choose **Save as PDF** in Chrome's print dialog, and save the report. The print layout is set to A4 portrait.

## Desktop font downloads

WOFF and WOFF2 files are unpacked to their native TTF or OTF format. Existing desktop fonts retain their format. Subsets keep their original character coverage. Failed exports are listed in Download notes.txt.

## Permissions and privacy

The first scan asks for HTTP/HTTPS website access because font files and CSS frequently come from multiple separate domains. Chrome may describe this as permission to read and change website data. RipKit uses it to inspect the chosen tab and fetch its stylesheet/font resources. You can revoke this access in Chrome's extension settings.

- `activeTab`: identifies the tab selected using the toolbar icon.
- `scripting`: reads stylesheet and resource information from the selected page.
- `webRequest`: observes font request URLs for the selected tab while a capture is active.
- `storage`: stores temporary captures in browser-session memory so the background worker can restart safely.

There is no analytics, proxy or upload service. Website and font requests go directly to the original hosts. Captures are removed after finishing; unfinished captures expire when accessed after two minutes or when the browser session ends. Font previews and font bytes stay in the dashboard's memory until reset or closed.

## Limitations

- Chrome internal pages, the Chrome Web Store and other protected pages cannot be inspected.
- Host permission removes ordinary cross-origin read restrictions for extension requests. It cannot defeat server authentication, access controls, missing files or expired links. Direct resource fetches omit login cookies.
- System fonts and `local()`-only font declarations have no downloadable website file.
- Font declarations can include unused variants, alternate formats and language subsets. Results show unique file URLs, not only the fonts visibly used in a screenshot.
- Network requests from frames can be discovered during capture, but the DOM stylesheet inspection targets the main page and its accessible open shadow roots. Closed shadow roots, dynamically created FontFace buffers, delayed resources and fonts loaded outside the capture window may be missed.
- Discovery is capped at 150 fetched stylesheets, 12 levels of CSS imports and 25,000 inspected elements.
- Font availability is not a licence to reuse it. Check the font's licence.

## Verification

Version 1.1 adds image and brand inspection. Live Chrome installation and PDF rendering are not verified here.

JavaScript syntax, extension packaging and manifest checks passed. Automated tests cover selected-tab network isolation, deduplication, capture cleanup/expiry, imported stylesheet URL resolution and loaded-font discovery. The embedded decoder passed TTF and OTF round-trip checks using real fonts, preserving names and character maps, with JavaScript string code generation disabled; corrupt input was rejected.

Installation, permission prompts and the complete interface have not been tested in a live Chrome session in this environment.

## Source files

- `manifest.json`: Chrome configuration and permissions
- `background.js`: toolbar handling and temporary network captures
- `collector.js`: page stylesheet/resource inspection
- `dashboard.html`, `styles.css`, `app.js`: preview/download interface
- `woff2-worker.js`: packaged local decoder
- `THIRD-PARTY-LICENSES.txt`: decoder attribution and licence
