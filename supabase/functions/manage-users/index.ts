import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const roles = new Set(['assistant', 'consultant', 'subagency_owner']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'İstek desteklenmiyor.' }, 405);

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Yönetici girişi gerekli.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
    const anonKey = publishableKeys.default;
    const secretKey = secretKeys.default;
    const caller = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Oturum doğrulanamadı.' }, 401);

    const admin = createClient(url, secretKey, { auth: { persistSession: false } });
    const { data: actor } = await admin.from('profiles').select('role,active').eq('id', authData.user.id).maybeSingle();
    if (!actor?.active || actor.role !== 'admin') return json({ error: 'Bu işlem için yönetici yetkisi gerekli.' }, 403);

    const input = await request.json();
    if (input.action === 'reset_password') {
      const targetId = String(input.user_id ?? '');
      const newPassword = String(input.password ?? '');
      if (!targetId || newPassword.length < 12) return json({ error: 'En az 12 karakterlik geçici parola girin.' }, 400);
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, { password: newPassword });
      if (authUpdateError) return json({ error: 'Parola güncellenemedi.' }, 400);
      const { error } = await admin.from('profiles').update({ must_change_password: true, active: true }).eq('id', targetId);
      if (error) return json({ error: 'Parola güncellendi ancak hesap durumu kaydedilemedi.' }, 500);
      return json({ ok: true });
    }
    if (input.action === 'activate') {
      const targetId = String(input.user_id ?? '');
      if (!targetId || targetId === authData.user.id) return json({ error: 'Bu hesap işlemi yapılamadı.' }, 400);
      const { error } = await admin.from('profiles').update({ active: true }).eq('id', targetId);
      if (error) return json({ error: 'Hesap yeniden açılamadı.' }, 400);
      return json({ ok: true });
    }
    if (input.action === 'deactivate') {
      const targetId = String(input.user_id ?? '');
      if (!targetId || targetId === authData.user.id) return json({ error: 'Bu hesap devre dışı bırakılamaz.' }, 400);
      const { error } = await admin.from('profiles').update({ active: false }).eq('id', targetId);
      if (error) return json({ error: 'Hesap kapatılamadı.' }, 400);
      return json({ ok: true });
    }

    if (input.action !== 'create') return json({ error: 'İşlem tanınmadı.' }, 400);
    const fullName = String(input.full_name ?? '').trim();
    const username = String(input.username ?? '').trim().toLowerCase();
    const email = String(input.email ?? '').trim().toLowerCase();
    const phone = String(input.phone ?? '').trim();
    const password = String(input.password ?? '');
    const role = String(input.role ?? '');
    const agencyName = String(input.agency_name ?? '').trim();
    if (!fullName || !/^[a-z0-9._-]{3,32}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !roles.has(role)) {
      return json({ error: 'Ad soyad, geçerli e-posta, 3–32 karakter kullanıcı adı ve en az 12 karakter geçici parola girin.' }, 400);
    }
    if (role === 'subagency_owner' && !agencyName) return json({ error: 'Alt ajans sahibi için ajans adı gerekli.' }, 400);
    const { data: usernameTaken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (usernameTaken) return json({ error: 'Bu kullanıcı adı zaten kullanımda.' }, 409);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? 'Hesap oluşturulamadı.' }, 400);
    let agencyId: string | null = null;
    if (role === 'subagency_owner') {
      const { data: agency, error: agencyError } = await admin.from('agencies').insert({
        name: agencyName, contact_name: fullName, phone, email, owner_user_id: created.user.id,
      }).select('id').single();
      if (agencyError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: 'Alt ajans kaydı oluşturulamadı.' }, 400);
      }
      agencyId = agency.id;
    }
    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id, username, email, full_name: fullName, phone: phone || null,
      role, agency_id: agencyId, active: true, must_change_password: true,
    });
    if (profileError) {
      if (agencyId) await admin.from('agencies').delete().eq('id', agencyId);
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: 'Kullanıcı profili oluşturulamadı. E-posta veya kullanıcı adı zaten kayıtlı olabilir.' }, 400);
    }
    return json({ ok: true, user_id: created.user.id, username });
  } catch {
    return json({ error: 'İşlem tamamlanamadı.' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
