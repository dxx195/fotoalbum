import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function codeOk(req) {
  const juist = Netlify.env.get("UPLOAD_CODE");
  const gegeven = req.headers.get("x-code") || "";
  return Boolean(juist) && gegeven === juist;
}

export default async (req) => {
  const url = new URL(req.url);
  const pad = url.pathname.replace(/^\/api\/?/, "");
  const fotos = getStore({ name: "fotos", consistency: "strong" });

  // Lijst van alle foto's (voor iedereen)
  if (req.method === "GET" && pad === "lijst") {
    const { blobs } = await fotos.list();
    const items = [];
    for (const b of blobs) {
      const meta = await fotos.getMetadata(b.key);
      items.push({ id: b.key, titel: meta?.metadata?.titel || "", tijd: meta?.metadata?.tijd || 0 });
    }
    items.sort((a, b) => b.tijd - a.tijd);
    return json(items);
  }

  // Een foto zelf (voor iedereen)
  if (req.method === "GET" && pad.startsWith("foto/")) {
    const id = pad.slice(5);
    const res = await fotos.getWithMetadata(id, { type: "arrayBuffer" });
    if (!res) return new Response("Niet gevonden", { status: 404 });
    return new Response(res.data, {
      headers: {
        "content-type": res.metadata?.type || "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Code controleren
  if (req.method === "POST" && pad === "check") {
    return codeOk(req) ? json({ ok: true }) : json({ ok: false }, 401);
  }

  // Foto toevoegen (alleen met code)
  if (req.method === "POST" && pad === "upload") {
    if (!codeOk(req)) return json({ fout: "Verkeerde code" }, 401);
    const form = await req.formData();
    const bestand = form.get("foto");
    const titel = String(form.get("titel") || "").slice(0, 100);
    if (!bestand || typeof bestand === "string") return json({ fout: "Geen foto" }, 400);
    if (!bestand.type.startsWith("image/")) return json({ fout: "Alleen foto's" }, 400);
    if (bestand.size > 5 * 1024 * 1024) return json({ fout: "Foto te groot" }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await fotos.set(id, await bestand.arrayBuffer(), {
      metadata: { titel, type: bestand.type, tijd: Date.now() },
    });
    return json({ ok: true, id });
  }

  // Foto verwijderen (alleen met code)
  if (req.method === "DELETE" && pad.startsWith("foto/")) {
    if (!codeOk(req)) return json({ fout: "Verkeerde code" }, 401);
    await fotos.delete(pad.slice(5));
    return json({ ok: true });
  }

  return json({ fout: "Onbekend" }, 404);
};

export const config = { path: "/api/*" };
