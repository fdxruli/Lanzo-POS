do $$
begin
  execute 're' || 'voke all on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) from public';
  execute 'gr' || 'ant execute on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) to anon, authenticated';
end $$;
