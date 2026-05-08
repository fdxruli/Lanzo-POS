/**
 * Componente para mostrar preguntas inteligentes en el wizard
 * Muestra opciones con iconos y descripciones para facilitar la selección
 */
export default function SmartQuestions({
    questions,
    visibleQuestions,
    answers,
    answerQuestion,
    progress
}) {
    if (!questions || questions.length === 0) return null;

    return (
        <div className="smart-questions-container" style={{
            backgroundColor: '#f8fafc',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            marginBottom: '20px'
        }}>
            {/* Header con progreso */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '20px'
            }}>
                <span style={{ fontSize: '1.3rem' }}>🤔</span>
                <div style={{ flex: 1 }}>
                    <p style={{
                        margin: 0,
                        fontSize: '0.95rem',
                        fontWeight: '600',
                        color: '#1e293b'
                    }}>
                        Ayúdame a configurar este producto
                    </p>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginTop: '8px'
                    }}>
                        <div style={{
                            flex: 1,
                            height: '6px',
                            backgroundColor: '#e2e8f0',
                            borderRadius: '3px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${progress.percentage}%`,
                                backgroundColor: '#3b82f6',
                                transition: 'width 0.3s ease'
                            }}></div>
                        </div>
                        <span style={{
                            fontSize: '0.8rem',
                            color: '#64748b',
                            fontWeight: '500'
                        }}>
                            {progress.answered}/{progress.total}
                        </span>
                    </div>
                </div>
            </div>

            {/* Preguntas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {visibleQuestions.map((question, index) => (
                    <SmartQuestionItem
                        key={question.id}
                        question={question}
                        value={answers[question.id]}
                        onAnswer={(value) => answerQuestion(question.id, value)}
                        delay={index * 100}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * Componente individual para cada pregunta
 */
function SmartQuestionItem({ question, value, onAnswer, delay = 0 }) {
    const isAnswered = value !== undefined && value !== null && value !== '';

    return (
        <div style={{
            animation: `fadeIn 0.3s ease ${delay}ms backwards`,
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '10px',
            border: isAnswered ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            boxShadow: isAnswered ? '0 2px 8px rgba(59, 130, 246, 0.15)' : 'none',
            transition: 'all 0.3s ease'
        }}>
            {/* Pregunta */}
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                marginBottom: '12px'
            }}>
                <span style={{ fontSize: '1.8rem' }}>{question.icon}</span>
                <div>
                    <p style={{
                        margin: 0,
                        fontSize: '1rem',
                        fontWeight: '600',
                        color: '#1e293b'
                    }}>
                        {question.question}
                    </p>
                    {question.helpText && (
                        <p style={{
                            margin: '4px 0 0 0',
                            fontSize: '0.85rem',
                            color: '#64748b'
                        }}>
                            💡 {question.helpText}
                        </p>
                    )}
                </div>
            </div>

            {/* Opciones de respuesta */}
            {question.type === 'yesno' ? (
                <YesNoOptions value={value} onChange={onAnswer} />
            ) : question.type === 'number' ? (
                <NumberInput
                    value={value}
                    onChange={onAnswer}
                    unit={question.unit}
                    placeholder={question.placeholder}
                />
            ) : question.type === 'select' ? (
                <SelectOptions
                    options={question.options}
                    value={value}
                    onChange={onAnswer}
                    displayMode="compact"
                />
            ) : question.type === 'multiselect' ? (
                <MultiSelectOptions
                    options={question.options}
                    value={value || []}
                    onChange={onAnswer}
                />
            ) : (
                <GridOptions
                    options={question.options}
                    value={value}
                    onChange={onAnswer}
                />
            )}
        </div>
    );
}

/**
 * Opciones en grid (layout principal)
 */
function GridOptions({ options, value, onChange }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '10px'
        }}>
            {options.map(option => {
                const isSelected = value === option.value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        style={{
                            padding: '12px',
                            borderRadius: '10px',
                            border: isSelected ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                            backgroundColor: isSelected ? '#eff6ff' : 'white',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            textAlign: 'left',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            alignItems: 'flex-start'
                        }}
                    >
                        <span style={{ fontSize: '1.5rem' }}>{option.icon}</span>
                        <div>
                            <span style={{
                                display: 'block',
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                color: isSelected ? '#1d4ed8' : '#1e293b'
                            }}>
                                {option.label}
                            </span>
                            {option.description && (
                                <span style={{
                                    display: 'block',
                                    fontSize: '0.75rem',
                                    color: isSelected ? '#3b82f6' : '#94a3b8',
                                    marginTop: '2px'
                                }}>
                                    {option.description}
                                </span>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Opciones Sí/No
 */
function YesNoOptions({ value, onChange }) {
    return (
        <div style={{ display: 'flex', gap: '10px' }}>
            <button
                type="button"
                onClick={() => onChange(true)}
                style={{
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: '8px',
                    border: value === true ? '2px solid #22c55e' : '2px solid #e2e8f0',
                    backgroundColor: value === true ? '#f0fdf4' : 'white',
                    color: value === true ? '#166534' : '#64748b',
                    fontWeight: value === true ? '600' : '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontSize: '0.95rem'
                }}
            >
                ✅ Sí
            </button>
            <button
                type="button"
                onClick={() => onChange(false)}
                style={{
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: '8px',
                    border: value === false ? '2px solid #ef4444' : '2px solid #e2e8f0',
                    backgroundColor: value === false ? '#fef2f2' : 'white',
                    color: value === false ? '#991b1b' : '#64748b',
                    fontWeight: value === false ? '600' : '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontSize: '0.95rem'
                }}
            >
                ❌ No
            </button>
        </div>
    );
}

/**
 * Input numérico
 */
function NumberInput({ value, onChange, unit, placeholder }) {
    return (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
                type="number"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '2px solid #e2e8f0',
                    fontSize: '1rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
            />
            {unit && (
                <span style={{
                    fontSize: '0.9rem',
                    color: '#64748b',
                    fontWeight: '500',
                    minWidth: '80px'
                }}>
                    {unit}
                </span>
            )}
        </div>
    );
}

/**
 * Opciones select (compacto)
 */
function SelectOptions({ options, value, onChange, displayMode = 'compact' }) {
    if (displayMode === 'compact') {
        return (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {options.map(option => {
                    const isSelected = value === option.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => onChange(option.value)}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '20px',
                                border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                backgroundColor: isSelected ? '#eff6ff' : 'white',
                                color: isSelected ? '#1d4ed8' : '#64748b',
                                fontWeight: isSelected ? '600' : '500',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                fontSize: '0.9rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <span>{option.icon}</span>
                            {option.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    return <GridOptions options={options} value={value} onChange={onChange} />;
}

/**
 * Opciones múltiples (checkboxes)
 */
function MultiSelectOptions({ options, value = [], onChange }) {
    const toggleOption = (optionValue) => {
        const newValue = value.includes(optionValue)
            ? value.filter(v => v !== optionValue)
            : [...value, optionValue];
        onChange(newValue);
    };

    return (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {options.map(option => {
                const isSelected = value.includes(option.value);
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => toggleOption(option.value)}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '20px',
                            border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                            backgroundColor: isSelected ? '#eff6ff' : 'white',
                            color: isSelected ? '#1d4ed8' : '#64748b',
                            fontWeight: isSelected ? '600' : '500',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <span>{isSelected ? '☑️' : '⬜'}</span>
                        <span>{option.icon}</span>
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
