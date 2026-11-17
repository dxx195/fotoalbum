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

async function hash(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fotoalbum:" + t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function leesCookie(req, naam) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + naam + "=([^;]*)"));
  return m ? m[1] : "";
}

// Mag deze bezoeker kijken? (kijkcode-cookie of uploadcode)
async function magKijken(req) {
  if (codeOk(req)) return true;
  const koek = leesCookie(req, "kijk");
  if (!koek) return false;
  const kijk = Netlify.env.get("KIJK_CODE");
  const upload = Netlify.env.get("UPLOAD_CODE");
  if (kijk && koek === (await hash(kijk))) return true;
  if (upload && koek === (await hash(upload))) return true;
  return false;
}

export default async (req) => {
  const url = new URL(req.url);
  const pad = url.pathname.replace(/^\/api\/?/, "");
  const fotos = getStore({ name: "fotos", consistency: "strong" });

  // Kijkcode invoeren
  if (req.method === "POST" && pad === "kijk") {
    const kijk = Netlify.env.get("KIJK_CODE");
    const gegeven = req.headers.get("x-kijk") || "";
    const upload = Netlify.env.get("UPLOAD_CODE");
    const goed = (kijk && gegeven === kijk) || (upload && gegeven === upload);
    if (!goed) return json({ ok: false }, 401);
    const waarde = await hash(gegeven);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": `kijk=${waarde}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
      },
    });
  }

  // Uitloggen
  if (req.method === "POST" && pad === "uit") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": "kijk=; Path=/; Max-Age=0" },
    });
  }

  // Lijst van alle foto's (alleen met toestemming)
  if (req.method === "GET" && pad === "lijst") {
    if (!(await magKijken(req))) return json({ fout: "Geen toegang" }, 401);
    const { blobs } = await fotos.list();
    const items = [];
    for (const b of blobs) {
      const meta = await fotos.getMetadata(b.key);
      items.push({ id: b.key, titel: meta?.metadata?.titel || "", tijd: meta?.metadata?.tijd || 0 });
    }
    items.sort((a, b) => b.tijd - a.tijd);
    return json(items);
  }

  // Een foto zelf (alleen met toestemming)
  if (req.method === "GET" && pad.startsWith("foto/")) {
    if (!(await magKijken(req))) return new Response("Geen toegang", { status: 401 });
    const id = pad.slice(5);
    const res = await fotos.getWithMetadata(id, { type: "arrayBuffer" });
    if (!res) return new Response("Niet gevonden", { status: 404 });
    return new Response(res.data, {
      headers: {
        "content-type": res.metadata?.type || "image/jpeg",
        "cache-control": "private, max-age=86400",
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
