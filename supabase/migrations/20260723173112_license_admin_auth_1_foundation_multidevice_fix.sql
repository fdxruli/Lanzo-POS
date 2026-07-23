-- Foundation compensation: administrative identity supports multiple active
-- devices up to licenses.max_devices. The old partial index predated sessions
-- and incorrectly made the second authenticated admin impossible.
drop index if exists public.uq_license_devices_one_active_admin;
