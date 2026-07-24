revoke execute on function public.release_device_anon(uuid, text, text) from public;
revoke execute on function public.deactivate_device_anon(uuid, text, text) from public;

grant execute on function public.release_device_anon(uuid, text, text) to anon, authenticated;
grant execute on function public.deactivate_device_anon(uuid, text, text) to anon, authenticated;;
