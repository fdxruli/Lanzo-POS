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
            backgroundColor: 'var(--light-background)',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
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
                        color: 'var(--text-dark)'
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
                            backgroundColor: 'var(--border-color)',
                            borderRadius: '3px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${progress.percentage}%`,
                                backgroundColor: 'var(--primary-color)',
                                transition: 'width 0.3s ease'
                            }}></div>
                        </div>
                        <span style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-light)',
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
            backgroundColor: 'var(--card-background-color)',
            padding: '16px',
            borderRadius: '10px',
            border: isAnswered ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
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
                        color: 'var(--text-dark)'
                    }}>
                        {question.question}
                    </p>
                    {question.helpText && (
                        <p style={{
                            margin: '4px 0 0 0',
                            fontSize: '0.85rem',
                            color: 'var(--text-light)'
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
                            border: isSelected ? '2px solid var(--primary-color)' : '2px solid var(--border-color)',
                            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--card-background-color)',
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
                                color: isSelected ? 'var(--primary-color)' : 'var(--text-dark)'
                            }}>
                                {option.label}
                            </span>
                            {option.description && (
                                <span style={{
                                    display: 'block',
                                    fontSize: '0.75rem',
                                    color: isSelected ? 'var(--primary-color)' : 'var(--text-light)',
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
                    border: value === true ? '2px solid var(--success-color)' : '2px solid var(--border-color)',
                    backgroundColor: value === true ? 'rgba(0, 196, 140, 0.1)' : 'var(--card-background-color)',
                    color: value === true ? 'var(--success-color)' : 'var(--text-light)',
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
                    border: value === false ? '2px solid var(--error-color)' : '2px solid var(--border-color)',
                    backgroundColor: value === false ? 'rgba(255, 59, 92, 0.1)' : 'var(--card-background-color)',
                    color: value === false ? 'var(--error-color)' : 'var(--text-light)',
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
                    border: '2px solid var(--border-color)',
                    fontSize: '1rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--primary-color)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
            />
            {unit && (
                <span style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-light)',
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
                                border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--card-background-color)',
                                color: isSelected ? 'var(--primary-color)' : 'var(--text-light)',
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
                            border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--card-background-color)',
                            color: isSelected ? 'var(--primary-color)' : 'var(--text-light)',
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
