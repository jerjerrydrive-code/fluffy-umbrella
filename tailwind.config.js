/** Tailwind build config.
 *  index.html is a single file with all markup AND all JS inline, so scanning it as raw text
 *  catches every class — including the ones inside template literals in the JS, since they
 *  appear literally in the source. Output goes to vendor/tailwind.css and is committed, so the
 *  app stays self-contained and needs no build step to run. */
module.exports = {
    content: ['./index.html'],
    theme: { extend: {} },
    plugins: []
};
