-- Temporary triggers required to exercise the production v2 pilot path.
CREATE TRIGGER pos_fin01_register_new_tenant_v2
AFTER INSERT ON public.licenses
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_register_new_tenant_v2();

CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_customers
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_customer_ledger
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_sale_items
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_sale_payments
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_cash_sessions
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_cash_movements
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
CREATE TRIGGER pos_fin01_guard_qa_write_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.pos_financial_operations
FOR EACH ROW EXECUTE FUNCTION private.pos_fin01_guard_qa_write_v2();
