// The theme before the first paint: what the operator chose (`pikit-theme`: light, dark), or the
// system's. A plain script of its own, loaded by index.html's <head>: the Content-Security-Policy
// allows no inline script. src/lib/theme.ts keeps it up to date afterwards.
(function () {
  var choice = null;
  try {
    choice = localStorage.getItem("pikit-theme");
  } catch (error) {}
  var dark = choice === "dark" || (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
