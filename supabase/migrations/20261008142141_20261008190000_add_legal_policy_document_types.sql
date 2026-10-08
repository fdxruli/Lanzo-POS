-- Amplía el catálogo de tipos legales consultado por get_active_legal_terms.
alter type public.legal_doc_type add value if not exists 'ai_policy';
alter type public.legal_doc_type add value if not exists 'payment_policy';
alter type public.legal_doc_type add value if not exists 'refund_policy';
alter type public.legal_doc_type add value if not exists 'legal_notice';
