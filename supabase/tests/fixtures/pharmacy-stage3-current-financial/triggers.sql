-- Isolated fixture ONLY. Existing Production triggers, not new application behavior.
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_cash_movements FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_cash_sessions FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_customer_ledger FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_customers FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_financial_operations FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_sale_items FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_sale_payments FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR DELETE OR UPDATE ON public.pos_sales FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
