-- CUSTOMER.MESSAGING.PHASE3.SQL.REGEX.FIX
-- Dollar-quoted PostgreSQL regexes prevent JavaScript-style double escaping.

create or replace function private.customer_message_template_valid(p_event_type text, p_template jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_all_text text; v_key text;
  v_allowed text[] := array['business.name', 'customer.name', 'occurredAt', 'reference', 'currency'];
  v_required text[] := array['business.name', 'customer.name', 'occurredAt'];
begin
  if p_template is null or jsonb_typeof(p_template) <> 'object' or (select count(*) from jsonb_object_keys(p_template)) <> 4
     or not (p_template ?& array['schemaVersion', 'title', 'body', 'footer']) or p_template->>'schemaVersion' <> '1'
     or jsonb_typeof(p_template->'title') <> 'string' or jsonb_typeof(p_template->'body') <> 'string' or jsonb_typeof(p_template->'footer') <> 'string'
     or length(btrim(p_template->>'title')) = 0 or length(btrim(p_template->>'body')) = 0
     or length(p_template->>'title') > 100 or length(p_template->>'body') > 5000 or length(p_template->>'footer') > 500 then return false; end if;
  v_allowed := v_allowed || case p_event_type
    when 'sale_paid' then array['sale.items','sale.total','sale.receivedAmount','sale.balanceDue','sale.paymentMethodLabel','sale.dueDate','sale.creditStatus']
    when 'sale_credit' then array['sale.items','sale.total','sale.receivedAmount','sale.balanceDue','sale.paymentMethodLabel','sale.dueDate','sale.creditStatus']
    when 'payment_partial' then array['payment.amount','payment.previousBalance','payment.newBalance','payment.methodLabel','payment.reference']
    when 'account_settled' then array['payment.amount','payment.previousBalance','payment.newBalance','payment.methodLabel','payment.reference']
    when 'account_statement' then array['account.totalBalance','account.totalPayments','account.cutoffAt','account.pendingNotes']
    when 'debt_reminder' then array['account.totalBalance','account.cutoffAt','account.pendingNotes']
    when 'layaway_created' then array['layaway.reference','layaway.total','layaway.initialPayment','layaway.balanceDue','layaway.deadline','layaway.status']
    when 'layaway_payment' then array['layaway.reference','layaway.paymentAmount','layaway.totalPaid','layaway.balanceDue','layaway.deadline','layaway.status']
    when 'layaway_settled' then array['layaway.reference','layaway.total','layaway.totalPaid','layaway.balanceDue','layaway.deadline','layaway.status']
    when 'layaway_delivered' then array['layaway.reference','layaway.total','layaway.totalPaid','layaway.balanceDue','layaway.deadline','layaway.status','layaway.saleFolio']
    when 'layaway_cancelled' then array['layaway.reference','layaway.total','layaway.totalPaid','layaway.balanceDue','layaway.status'] else array[]::text[] end;
  v_required := v_required || case p_event_type
    when 'sale_paid' then array['sale.total','sale.paymentMethodLabel'] when 'sale_credit' then array['sale.total','sale.balanceDue','sale.paymentMethodLabel']
    when 'payment_partial' then array['payment.amount','payment.newBalance','payment.methodLabel'] when 'account_settled' then array['payment.amount','payment.newBalance','payment.methodLabel']
    when 'account_statement' then array['account.totalBalance'] when 'debt_reminder' then array['account.totalBalance']
    when 'layaway_created' then array['layaway.reference','layaway.total','layaway.initialPayment','layaway.balanceDue']
    when 'layaway_payment' then array['layaway.reference','layaway.paymentAmount','layaway.totalPaid','layaway.balanceDue']
    when 'layaway_settled' then array['layaway.reference','layaway.totalPaid','layaway.balanceDue']
    when 'layaway_delivered' then array['layaway.reference','layaway.saleFolio'] when 'layaway_cancelled' then array['layaway.reference','layaway.status'] else array[]::text[] end;
  if p_event_type = 'debt_reminder' then v_required := array['business.name','customer.name','account.totalBalance']; end if;
  v_all_text := coalesce(p_template->>'title','') || E'\n' || coalesce(p_template->>'body','') || E'\n' || coalesce(p_template->>'footer','');
  if v_all_text ~* $$<[[:alpha:]][^>]*>|javascript[[:space:]]*:|data[[:space:]]*:[[:space:]]*text/html|https?://|\mwww\.$$ 
     or v_all_text ~ $$([$€£][[:space:]]*[0-9]+([.,][0-9]{3})*([.,][0-9]{1,2})?|\m[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}\M|\m[0-9]{1,3}(\.[0-9]{3})*,[0-9]{2}\M|\m[0-9]+[,.][0-9]{2}\M)$$
     or regexp_replace(v_all_text, $$\{\{[^}]*\}\}$$, '', 'g') ~ '[{}]'
     or (select count(*) from regexp_matches(v_all_text, $$\{\{([^}]*)\}\}$$, 'g')) > 60
     or (length(v_all_text) - length(replace(v_all_text, E'\n', '')) + 3) > 160 then return false; end if;
  for v_key in select match[1] from regexp_matches(v_all_text, $$\{\{([^}]*)\}\}$$, 'g') as match loop if not (v_key = any(v_allowed)) then return false; end if; end loop;
  foreach v_key in array v_required loop if position('{{' || v_key || '}}' in v_all_text) = 0 then return false; end if; end loop;
  return true;
end;
$function$;

notify pgrst, 'reload schema';
