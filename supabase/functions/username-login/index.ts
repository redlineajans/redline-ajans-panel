import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'İstek desteklenmiyor.' }, 405);

  try {
    const { username, password } = await request.json();
    const normalized = String(username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(normalized) || typeof password !== 'string' || password.length < 1) {
      return json({ error: 'Kullanıcı adı veya parola hatalı.' }, 401);
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
    const anonKey = publishableKeys.default;
    const secretKey = secretKeys.default;
    const admin = createClient(url, secretKey, { auth: { persistSession: false } });
    const { data: profile } = await admin.from('profiles')
      .select('email,active,must_change_password')
      .eq('username', normalized)
      .maybeSingle();

    if (!profile || !profile.active) return json({ error: 'Kullanıcı adı veya parola hatalı.' }, 401);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await userClient.auth.signInWithPassword({ email: profile.email, password });
    if (error || !data.session) return json({ error: 'Kullanıcı adı veya parola hatalı.' }, 401);
    return json({ session: data.session, must_change_password: profile.must_change_password });
  } catch {
    return json({ error: 'Giriş yapılamadı. Bilgileri kontrol edip tekrar deneyin.' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
