-- Keep incident tenant identity immutable when a linked notification is deleted.

begin;

alter table private.pos_notification_operational_incidents
  drop constraint if exists pos_notification_operational_incidents_notification_license_fkey;

alter table private.pos_notification_operational_incidents
  add constraint pos_notification_operational_incidents_notification_license_fkey
  foreign key (notification_id, license_id)
  references public.pos_notifications(id, license_id)
  on delete set null (notification_id);

commit;
