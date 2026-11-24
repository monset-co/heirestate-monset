// The splash's picture (admin/index.html): the logo's build on a device's first open, after that
// the finished logo. A file, not an inline script, so the admin's CSP (no inline scripts) lets it run.
(function () {
  var first = true;
  try {
    first = !localStorage.getItem("heir-admin-intro") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    localStorage.setItem("heir-admin-intro", "1");
  } catch (e) {}
  var s = document.getElementById("splash");
  s.firstChild.src = first ? "/loader.svg" : "/logo.svg";
  s.dataset.until = first ? 3900 : 400;
})();
