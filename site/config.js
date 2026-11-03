window.ALPHA_CONFIG = Object.freeze({
  supabaseUrl: "",
  publishableKey: "",
  localApi: ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://127.0.0.1:8017" : "",
});
