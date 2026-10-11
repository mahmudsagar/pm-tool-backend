/**
 * Board automation workflow rules (board.automations.workflowRules), applied server-side when
 * task values change: PUT /v1/page/document and PUT /v1/board/tasks.
 */

export const valuesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const toDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

export const evaluateRuleTrigger = (rule, nextValues, changedFields) => {
    const trigger = rule?.trigger || {};
    const field = trigger.field;
    if (!field || !changedFields.has(field)) return false;
    const operator = trigger.operator || 'equals';
    const expected = String(trigger.value ?? '');
    const actual = String(nextValues[field] ?? '');
    if (operator === 'not_equals') return actual !== expected;
    return actual === expected;
};

export const applyRuleAction = (rule, nextValues) => {
    const action = rule?.action || {};
    const actionType = action.type;
    const actionValue = action.value;
    if (!actionType) return false;

    if (actionType === 'assign') {
        if (!actionValue) return false;
        nextValues.assignee = actionValue;
        return true;
    }
    if (actionType === 'set_status') {
        nextValues.status = actionValue;
        return true;
    }
    if (actionType === 'set_priority') {
        nextValues.priority = actionValue;
        return true;
    }
    if (actionType === 'add_tag') {
        const existingTags = Array.isArray(nextValues.tags) ? nextValues.tags : [];
        if (!actionValue || existingTags.includes(actionValue)) return false;
        nextValues.tags = [...existingTags, actionValue];
        return true;
    }
    if (actionType === 'set_start_date_offset') {
        const due = toDate(nextValues.due_date);
        const offset = Number(actionValue);
        if (!due || Number.isNaN(offset)) return false;
        due.setDate(due.getDate() - offset);
        nextValues.start_date = due.toISOString().split('T')[0];
        return true;
    }
    return false;
};

/**
 * Run the enabled rules of `board` for a task whose values went from `previousValues` to
 * `nextValues`. Returns the mutated values, or null when no rule changed anything.
 */
export const runWorkflowRules = (board, previousValues = {}, nextValues = {}) => {
    const rules = board?.automations?.workflowRules || [];
    if (!Array.isArray(rules) || rules.length === 0) return null;
    const values = { ...nextValues };
    const changedFields = new Set(
        Object.keys({ ...previousValues, ...values }).filter((key) => !valuesEqual(previousValues[key], values[key]))
    );
    let mutated = false;
    rules
        .filter((rule) => rule && rule.enabled !== false)
        .forEach((rule) => {
            if (!evaluateRuleTrigger(rule, values, changedFields)) return;
            const before = JSON.stringify(values);
            if (applyRuleAction(rule, values) && before !== JSON.stringify(values)) mutated = true;
        });
    return mutated ? values : null;
};
