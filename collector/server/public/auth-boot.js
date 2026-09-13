(function () {
  try {
    var t =
      sessionStorage.getItem("collector_token") ||
      localStorage.getItem("collector_token") ||
      "";
    if (t) document.documentElement.classList.add("is-authenticated");
  } catch (e) {}
})();
