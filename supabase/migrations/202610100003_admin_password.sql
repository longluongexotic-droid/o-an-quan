-- Password-only administration uses a fixed, nonpersonal account identifier.
-- Create the confirmed Auth user separately; never put its password in SQL/Git.
-- Existing admin permissions, RPC checks and audit history remain intact.
begin;

insert into oaq_private.admin_allowlist(email)
values ('quanly@trangnguyenkylo.invalid')
on conflict (email) do nothing;

commit;
