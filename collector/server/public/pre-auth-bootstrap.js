try {
  var t = sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "";
  if (t) {
    document.documentElement.classList.add("pre-auth");
    setTimeout(function () {
      document.documentElement.classList.remove("pre-auth");
    }, 3000);
  }
} catch (e) {}
