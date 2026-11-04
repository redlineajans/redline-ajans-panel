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
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Giriş gerekli.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
    const anon = createClient(url, publishableKeys.default, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Oturum doğrulanamadı.' }, 401);
    const admin = createClient(url, secretKeys.default, { auth: { persistSession: false } });
    const { error: updateError } = await admin.from('profiles').update({ must_change_password: false }).eq('id', data.user.id);
    if (updateError) return json({ error: 'Parola durumu güncellenemedi.' }, 400);
    return json({ ok: true });
  } catch {
    return json({ error: 'İşlem tamamlanamadı.' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
