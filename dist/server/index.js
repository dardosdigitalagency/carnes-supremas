const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    if (url.pathname === "/hoteles-restaurantes") url.pathname = "/hoteles-restaurantes.html";
    if (url.pathname === "/nosotros") url.pathname = "/nosotros.html";

    if (env.ASSETS?.fetch) {
      const response = await env.ASSETS.fetch(new Request(url, request));
      if (response.status !== 404) return response;
    }

    return new Response("Página no encontrada", {
      status: 404,
      headers: { "content-type": contentTypes[url.pathname.slice(url.pathname.lastIndexOf("."))] || "text/plain; charset=utf-8" }
    });
  }
};
