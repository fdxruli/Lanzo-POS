import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showConfirmModal } from '../../services/utils';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsAccess, useSettingsActionGuard } from '../../services/auth/useSettingsAccess';
import { getCommercialPlanName } from '../../utils/planDisplay';
import {
  CUSTOMER_MESSAGE_EVENT_TYPES,
  buildCustomerMessageTemplatePreviewPayload,
  canManageCustomerMessageTemplates,
  getDefaultCustomerMessageTemplate,
  getTemplateVariablesForEvent,
  listCustomerMessageTemplates,
  renderCustomerMessageImage,
  resetCustomerMessageTemplate,
  saveCustomerMessageTemplate,
  validateCustomerMessageTemplate
} from '../../services/customerMessaging';
import './CustomerMessageTemplatesSettings.css';

const EVENT_LABELS = Object.freeze({
  sale_paid: 'Venta pagada', sale_credit: 'Venta a crédito', account_statement: 'Estado de cuenta',
  payment_partial: 'Abono', account_settled: 'Cuenta saldada', layaway_created: 'Apartado creado',
  layaway_payment: 'Abono de apartado', layaway_settled: 'Apartado liquidado',
  layaway_delivered: 'Apartado entregado', layaway_cancelled: 'Apartado cancelado', debt_reminder: 'Recordatorio de saldo'
});

const clone = (template) => ({ ...template });

export default function CustomerMessageTemplatesSettings() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const access = useSettingsAccess();
  const guard = useSettingsActionGuard();
  const canvasRef = useRef(null);
  const dictionaryRef = useRef(null);
  const [eventType, setEventType] = useState('sale_paid');
  const [customTemplates, setCustomTemplates] = useState({});
  const [draft, setDraft] = useState(() => clone(getDefaultCustomerMessageTemplate('sale_paid')));
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState({ ok: true, errors: [] });
  const [activeField, setActiveField] = useState('body');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const editable = canManageCustomerMessageTemplates({ licenseDetails, actorType: access.actorType });
  const selected = customTemplates[eventType];
  const variables = useMemo(() => getTemplateVariablesForEvent(eventType), [eventType]);
  const filteredVariables = useMemo(() => variables.filter((variable) => {
    const haystack = [variable.token, variable.name, variable.definition, variable.purpose].join(' ').toLocaleLowerCase();
    return (typeFilter === 'all' || variable.type === typeFilter) && haystack.includes(query.trim().toLocaleLowerCase());
  }), [query, typeFilter, variables]);
  const variableGroups = useMemo(() => Object.entries(filteredVariables.reduce((groups, variable) => {
    groups[variable.category] = [...(groups[variable.category] || []), variable];
    return groups;
  }, {})), [filteredVariables]);

  const changeEvent = (nextEvent) => {
    setEventType(nextEvent);
    setDraft(clone(customTemplates[nextEvent]?.template_json || getDefaultCustomerMessageTemplate(nextEvent)));
    setValidation({ ok: true, errors: [] });
    setStatus('');
  };

  const load = useCallback(async () => {
    if (!editable) return;
    setLoading(true);
    const actorHandle = guard('settings', { adminOnly: true });
    const result = await listCustomerMessageTemplates({ licenseDetails, actorHandle });
    if (result.ok) {
      const next = Object.fromEntries((result.templates || []).map((row) => [row.event_type, row]));
      setCustomTemplates(next);
      setDraft(clone(next[eventType]?.template_json || getDefaultCustomerMessageTemplate(eventType)));
    } else setStatus(`No se pudieron cargar las personalizaciones (${result.code}). Se muestra la plantilla genérica.`);
    setLoading(false);
  }, [editable, eventType, guard, licenseDetails]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const payload = buildCustomerMessageTemplatePreviewPayload(eventType);
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    renderCustomerMessageImage(payload, { template: draft, canvasFactory: () => canvas });
  }, [draft, eventType]);

  const update = (field, value) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setValidation(validateCustomerMessageTemplate(eventType, next));
  };

  const insertVariable = (variable) => {
    if (!editable || draft[activeField].includes(variable.token)) return;
    update(activeField, `${draft[activeField]}${draft[activeField].endsWith('\n') || !draft[activeField] ? '' : '\n'}${variable.token}`);
  };

  const openDictionary = () => {
    if (typeof dictionaryRef.current?.showModal === 'function') dictionaryRef.current.showModal();
  };

  const save = async () => {
    const checked = validateCustomerMessageTemplate(eventType, draft);
    setValidation(checked);
    if (!checked.ok) return;
    setLoading(true);
    const result = await saveCustomerMessageTemplate({
      eventType, template: draft, revision: selected?.revision || 0, licenseDetails,
      actorHandle: guard('settings', { adminOnly: true })
    });
    if (result.ok) {
      setCustomTemplates((current) => ({ ...current, [eventType]: result.template }));
      setStatus('Cambios guardados.');
    } else if (result.code === 'TEMPLATE_CONFLICT') setStatus('Conflicto: otro dispositivo actualizó este mensaje. Recarga antes de guardar.');
    else if (result.code === 'TEMPLATE_INVALID') setStatus('No se puede guardar la plantilla porque contiene una variable inválida, falta una variable obligatoria o incluye un importe escrito manualmente.');
    else setStatus('No se pudo guardar la plantilla. Intenta de nuevo.');
    setLoading(false);
  };

  const restore = async () => {
    if (!await showConfirmModal('Se eliminará solo la personalización de este evento y volverá al mensaje genérico.', { title: 'Restaurar mensaje', confirmButtonText: 'Restaurar' })) return;
    setLoading(true);
    const result = await resetCustomerMessageTemplate({
      eventType, revision: selected?.revision || 0, licenseDetails,
      actorHandle: guard('settings', { adminOnly: true })
    });
    if (result.ok) {
      setCustomTemplates((current) => {
        const next = { ...current }; delete next[eventType]; return next;
      });
      setDraft(clone(getDefaultCustomerMessageTemplate(eventType)));
      setStatus('Mensaje restaurado a la plantilla genérica.');
    } else if (result.code === 'TEMPLATE_CONFLICT') setStatus('Conflicto: recarga antes de restaurar.');
    else setStatus(`No se pudo restaurar (${result.code}).`);
    setLoading(false);
  };

  return (
    <div className="ui-card" aria-label="Mensajes al cliente">
      <h3>Mensajes al cliente</h3>
      <p>Canal: imagen. Plan actual: {getCommercialPlanName(licenseDetails)}.</p>
      {!editable && <p role="note">La edición de plantillas requiere Lanzo Nube con una sesión Admin/Owner. Seguirás compartiendo las imágenes genéricas.</p>}
      <label htmlFor="customer-message-event">Evento</label>
      <select id="customer-message-event" value={eventType} onChange={(event) => changeEvent(event.target.value)}>
        {CUSTOMER_MESSAGE_EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_LABELS[type]}</option>)}
      </select>
      {editable ? <>
        <label htmlFor="customer-message-title">Título</label>
        <input id="customer-message-title" value={draft.title} maxLength={100} onChange={(event) => update('title', event.target.value)} />
        <label htmlFor="customer-message-body">Cuerpo</label>
        <textarea id="customer-message-body" value={draft.body} maxLength={5000} rows={10} onChange={(event) => update('body', event.target.value)} />
        <label htmlFor="customer-message-footer">Pie de página</label>
        <textarea id="customer-message-footer" value={draft.footer} maxLength={500} rows={3} onChange={(event) => update('footer', event.target.value)} />
        <section className="customer-template-dictionary-summary" aria-label="Diccionario de variables">
          <h4>Variables automáticas</h4>
          <p>{variables.length} variables disponibles. Insertan datos confirmados automáticamente; los importes no se escriben manualmente.</p>
          <button type="button" onClick={openDictionary}>Abrir diccionario de variables</button>
        </section>
        {!validation.ok && <ul role="alert">{validation.errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.code}{error.variables ? `: ${error.variables.join(', ')}` : ''}</li>)}</ul>}
        <p>
          <button type="button" disabled={loading} onClick={save}>Guardar</button>{' '}
          <button type="button" disabled={loading} onClick={() => { setDraft(clone(selected?.template_json || getDefaultCustomerMessageTemplate(eventType))); setStatus('Cambios cancelados.'); }}>Cancelar</button>{' '}
          <button type="button" disabled={loading || !selected} onClick={restore}>Restaurar mensaje</button>
        </p>
      </> : <>
        <p>Vista de solo lectura de la plantilla genérica.</p>
        <section className="customer-template-dictionary-summary" aria-label="Diccionario de variables">
          <p>{variables.length} variables automáticas disponibles para este evento.</p>
          <button type="button" onClick={openDictionary}>Abrir diccionario de variables</button>
        </section>
      </>}
      {status && <p role="status">{status}</p>}
      {loading && <p>Guardando o cargando…</p>}
      <h4>Vista previa con datos ficticios</h4>
      <canvas ref={canvasRef} aria-label="Vista previa de mensaje como imagen" style={{ maxWidth: '100%', height: 'auto', border: '1px solid #cbd5e1' }} />
      <dialog ref={dictionaryRef} className="customer-template-dictionary" aria-labelledby="customer-template-dictionary-title">
        <div className="customer-template-dictionary__header">
          <div>
            <h3 id="customer-template-dictionary-title">Diccionario de variables</h3>
            <p>Elige una variable para insertar datos automáticos del evento. Nunca muestran IDs técnicos.</p>
          </div>
          <form method="dialog"><button type="submit" aria-label="Cerrar diccionario de variables">Cerrar</button></form>
        </div>
        {editable && <label className="customer-template-dictionary__target">Insertar en
          <select value={activeField} onChange={(event) => setActiveField(event.target.value)}>
            <option value="title">Título</option><option value="body">Cuerpo</option><option value="footer">Pie de página</option>
          </select>
        </label>}
        <div className="customer-template-dictionary__filters">
          <label>Buscar <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Token, nombre o definición" /></label>
          <label>Tipo <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos</option><option value="text">Texto</option><option value="money">Importe</option><option value="date">Fecha</option><option value="list">Lista</option></select></label>
        </div>
        <div className="customer-template-dictionary__content">
          {variableGroups.map(([category, group]) => <section key={category} className="customer-template-dictionary__group"><h4>{category}</h4><div className="customer-template-dictionary__grid">
            {group.map((variable) => <article key={variable.token} className="customer-template-variable-card">
              <code>{variable.token}</code><h5>{variable.name}</h5><p>{variable.definition}</p><p><strong>Uso:</strong> {variable.purpose}</p>
              <dl><div><dt>Tipo</dt><dd>{({ text: 'Texto', money: 'Importe', date: 'Fecha', list: 'Lista' })[variable.type]}</dd></div><div><dt>Estado</dt><dd>{variable.required ? 'Obligatoria' : 'Opcional'}</dd></div><div><dt>Ejemplo</dt><dd>{variable.example}</dd></div></dl>
              <button type="button" disabled={!editable || draft[activeField].includes(variable.token)} onClick={() => insertVariable(variable)}>{draft[activeField].includes(variable.token) ? 'Ya incluida' : 'Insertar'}</button>
            </article>)}
          </div></section>)}
          {variableGroups.length === 0 && <p>No hay variables que coincidan con la búsqueda.</p>}
        </div>
      </dialog>
    </div>
  );
}
