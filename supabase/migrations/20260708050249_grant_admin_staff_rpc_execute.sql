grant execute on function public.admin_list_staff_users(text, text, text) to anon, authenticated;
grant execute on function public.admin_create_staff_user(text, text, text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.admin_update_staff_user(text, text, text, uuid, text, jsonb, boolean, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
