package com.nexacrm.automation;

import com.nexacrm.model.Deal;
import com.nexacrm.model.Invoice;
import com.nexacrm.model.Lead;
import com.nexacrm.model.User;
import com.nexacrm.model.Workflow;
import com.nexacrm.model.WorkflowRunLog;
import com.nexacrm.dto.EmailSendRequest;
import com.nexacrm.repository.DealRepository;
import com.nexacrm.repository.InvoiceRepository;
import com.nexacrm.repository.LeadRepository;
import com.nexacrm.repository.UserRepository;
import com.nexacrm.repository.WorkflowRepository;
import com.nexacrm.repository.WorkflowRunLogRepository;
import com.nexacrm.security.TenantContext;
import com.nexacrm.service.CommunicationService;
import com.nexacrm.websocket.NotificationPublisher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Automation workflow engine — evaluates IF-THEN rules and executes actions.
 *
 * Supported triggers:
 * - LEAD_CREATED, LEAD_UPDATED, LEAD_SCORE_CHANGED
 * - DEAL_CREATED, DEAL_STAGE_CHANGED, DEAL_WON, DEAL_LOST
 * - INVOICE_OVERDUE, INVOICE_PAID
 * - TASK_OVERDUE, FOLLOW_UP_DUE
 *
 * Supported actions:
 * - ASSIGN_LEAD, SEND_EMAIL, SEND_WHATSAPP, SEND_CALL
 * - CREATE_TASK, ESCALATE, LOG_ACTIVITY
 * - GENERATE_INVOICE, SEND_NOTIFICATION
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WorkflowEngine {

    private static final List<String> STAGES = List.of("NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST");

    private final WorkflowRepository workflowRepository;
    private final WorkflowRunLogRepository workflowRunLogRepository;
    private final DealRepository dealRepository;
    private final InvoiceRepository invoiceRepository;
    private final LeadRepository leadRepository;
    private final UserRepository userRepository;
    private final CommunicationService communicationService;
    private final NotificationPublisher notificationPublisher;
    private final MongoTemplate mongoTemplate;

    public void processEvent(String trigger, Map<String, Object> context) {
        processEventAsync(trigger, context, TenantContext.currentTenantIdOrNull());
    }

    @Async
    public void processEventAsync(String trigger, Map<String, Object> context, Long tenantId) {
        boolean contextSet = false;
        if (tenantId != null && TenantContext.currentTenantIdOrNull() == null) {
            TenantContext.setCurrentTenantId(tenantId);
            contextSet = true;
        }
        try {
            Map<String, Object> safeContext = context != null ? context : Map.of();
            log.info("Processing automation trigger: {} with context keys: {}", trigger, safeContext.keySet());

            var activeWorkflows = workflowRepository.findByTenantIdAndDeletedFalseAndStatus(
                tenantId(),
                Workflow.WorkflowStatus.ACTIVE
            );
            if (activeWorkflows.isEmpty()) return;

            for (Workflow workflow : activeWorkflows) {
                try {
                    ExecutionOutcome outcome = executeWorkflow(workflow, trigger, safeContext);
                    if (!outcome.conditionMatched()) {
                        saveRunLog(workflow, trigger, "SKIPPED", "No matching IF/CONDITION rule for this trigger");
                        continue;
                    }
                    if (outcome.executedActions() == 0) {
                        String note = outcome.notes().isEmpty()
                            ? "No executable THEN action found"
                            : String.join(" | ", outcome.notes());
                        saveRunLog(workflow, trigger, "SKIPPED", note);
                        continue;
                    }
                    Integer currentRuns = workflow.getRuns() != null ? workflow.getRuns() : 0;
                    workflow.setRuns(currentRuns + 1);
                    workflow.setLastRun(LocalDateTime.now().toString());
                    workflowRepository.save(workflow);
                    saveRunLog(workflow, trigger, "EXECUTED", String.join(" | ", outcome.notes()));
                } catch (Exception ex) {
                    log.error("Workflow execution failed: workflowId={}, trigger={}", workflow.getId(), trigger, ex);
                    saveRunLog(workflow, trigger, "FAILED", ex.getMessage());
                }
            }
        } finally {
            if (contextSet) TenantContext.clear();
        }
    }

    private ExecutionOutcome executeWorkflow(Workflow workflow, String trigger, Map<String, Object> context) {
        List<Workflow.WorkflowStep> steps = workflow.getSteps() != null ? workflow.getSteps() : List.of();
        if (steps.isEmpty()) return new ExecutionOutcome(false, 0, List.of());

        boolean conditionMatched = false;
        boolean conditionFailed = false;
        int executedActions = 0;
        List<String> notes = new ArrayList<>();

        for (Workflow.WorkflowStep step : steps) {
            String stepType = normalize(step.getType()).toUpperCase(Locale.ROOT);
            String text = normalize(step.getText());
            if (!StringUtils.hasText(stepType) || !StringUtils.hasText(text)) continue;

            if ("IF".equals(stepType) || "CONDITION".equals(stepType)) {
                boolean matched = conditionMatches(stepType, text, trigger, context);
                if (matched) {
                    conditionMatched = true;
                    notes.add(stepType + " matched: " + text);
                } else {
                    conditionFailed = true;
                    notes.add(stepType + " not matched: " + text);
                    break;
                }
                continue;
            }

            if ("WAIT".equals(stepType)) {
                if (!conditionMatched || conditionFailed) continue;
                notes.add(waitStep(text));
                continue;
            }

            if ("THEN".equals(stepType)) {
                if (!conditionMatched || conditionFailed) continue;
                ActionResult actionResult = executeAction(workflow, text, trigger, context);
                if (StringUtils.hasText(actionResult.note())) notes.add(actionResult.note());
                if (actionResult.executed()) executedActions++;
            }
        }

        if (!conditionMatched || conditionFailed) return new ExecutionOutcome(false, 0, List.of());
        return new ExecutionOutcome(true, executedActions, notes);
    }

    private boolean conditionMatches(String stepType, String text, String trigger, Map<String, Object> context) {
        String normalizedTrigger = normalize(trigger).toUpperCase(Locale.ROOT);
        String lower = normalize(text).toLowerCase(Locale.ROOT);

        if (lower.startsWith("trigger:")) {
            String expected = lower.substring("trigger:".length()).trim().toUpperCase(Locale.ROOT).replace(' ', '_');
            return expected.equals(normalizedTrigger);
        }

        boolean triggerMatched =
            ("LEAD_CREATED".equals(normalizedTrigger) && (lower.contains("lead created") || lower.contains("new lead"))) ||
            ("LEAD_UPDATED".equals(normalizedTrigger) && lower.contains("lead updated")) ||
            ("DEAL_CREATED".equals(normalizedTrigger) && (lower.contains("deal created") || lower.contains("new deal"))) ||
            ("DEAL_STAGE_CHANGED".equals(normalizedTrigger) && (lower.contains("deal moved") || lower.contains("stage changed") || lower.contains("deal stage"))) ||
            lower.contains(normalizedTrigger.toLowerCase(Locale.ROOT).replace('_', ' '));

        if (!triggerMatched && "IF".equals(stepType)) return false;

        String expectedStage = extractStageFromText(lower);
        if (StringUtils.hasText(expectedStage)) {
            String stageFromContext = firstNonBlank(
                normalize((String) context.get("toStage")).toUpperCase(Locale.ROOT),
                normalize((String) context.get("stage")).toUpperCase(Locale.ROOT)
            );
            if (!expectedStage.equals(stageFromContext)) return false;
        }

        if (lower.contains("instagram") || lower.contains("facebook") || lower.contains("linkedin") || lower.contains("whatsapp")) {
            String source = normalize((String) context.get("source")).toLowerCase(Locale.ROOT);
            if (lower.contains("instagram") && !source.contains("instagram")) return false;
            if (lower.contains("facebook") && !source.contains("facebook")) return false;
            if (lower.contains("linkedin") && !source.contains("linkedin")) return false;
            if (lower.contains("whatsapp") && !source.contains("whatsapp")) return false;
        }

        return triggerMatched || "CONDITION".equals(stepType);
    }

    private ActionResult executeAction(Workflow workflow, String text, String trigger, Map<String, Object> context) {
        String lower = normalize(text).toLowerCase(Locale.ROOT);

        if (lower.startsWith("set_deal_stage:")) {
            String target = normalize(text.substring("set_deal_stage:".length())).toUpperCase(Locale.ROOT);
            String dealId = normalize((String) context.get("dealId"));
            return setDealStage(dealId, target);
        }

        if (lower.startsWith("set_lead_status:")) {
            String target = normalize(text.substring("set_lead_status:".length())).toUpperCase(Locale.ROOT);
            String leadId = normalize((String) context.get("leadId"));
            return setLeadStatus(leadId, target);
        }

        if (lower.startsWith("set_lead_score:")) {
            String target = normalize(text.substring("set_lead_score:".length())).toUpperCase(Locale.ROOT);
            String leadId = normalize((String) context.get("leadId"));
            return setLeadScore(leadId, target);
        }

        if (lower.startsWith("assign_lead:")) {
            String assignee = normalize(text.substring("assign_lead:".length()));
            String leadId = normalize((String) context.get("leadId"));
            return assignLead(leadId, assignee);
        }

        if (lower.startsWith("send_email:")) {
            String payload = normalize(text.substring("send_email:".length()));
            return sendEmailAction(payload, workflow.getName(), trigger);
        }

        if (lower.startsWith("send_whatsapp:")) {
            String payload = normalize(text.substring("send_whatsapp:".length()));
            return sendWhatsAppAction(payload, context);
        }

        if (lower.startsWith("send_call:")) {
            String payload = normalize(text.substring("send_call:".length()));
            return sendCallAction(payload, context);
        }

        if (lower.startsWith("notify:")) {
            String msg = normalize(text.substring("notify:".length()));
            return notifyAction(msg, workflow.getName(), trigger);
        }

        if (lower.contains("notify")) {
            return notifyAction(text, workflow.getName(), trigger);
        }
        if (lower.contains("send email")) {
            String leadEmail = normalize((String) context.get("leadEmail"));
            if (StringUtils.hasText(leadEmail)) {
                return sendEmailAction(leadEmail + "|Workflow Notification|" + text, workflow.getName(), trigger);
            }
        }
        if (lower.contains("send whatsapp") || lower.contains("whatsapp message")) {
            String leadPhone = normalize((String) context.get("leadPhone"));
            if (StringUtils.hasText(leadPhone)) {
                String leadName = normalize((String) context.get("leadName"));
                String greeting = StringUtils.hasText(leadName)
                    ? "Hi " + leadName + ", thank you for your interest! We will get back to you shortly."
                    : "Hi, thank you for your interest! We will get back to you shortly.";
                return sendWhatsAppAction(leadPhone + "|" + greeting, context);
            }
        }
        if (lower.contains("send call")) {
            String leadPhone = normalize((String) context.get("leadPhone"));
            if (StringUtils.hasText(leadPhone)) {
                return sendCallAction(leadPhone + "|Hello, this is NexaCRM calling about your enquiry.", context);
            }
        }
        if (lower.contains("reassign lead")) {
            String leadId = normalize((String) context.get("leadId"));
            return assignLead(leadId, "");
        }

        return new ActionResult(false, "No executable action mapped for step: " + text);
    }

    private ActionResult setDealStage(String dealId, String targetStage) {
        if (!StringUtils.hasText(dealId)) return new ActionResult(false, "set_deal_stage skipped: dealId missing in context");
        Deal deal = dealRepository.findByIdAndTenantIdAndDeletedFalse(dealId, tenantId()).orElse(null);
        if (deal == null) return new ActionResult(false, "set_deal_stage skipped: deal not found");
        try {
            Deal.DealStage stage = Deal.DealStage.valueOf(targetStage);
            deal.setStage(stage);
            dealRepository.save(deal);
            return new ActionResult(true, "Deal stage updated to " + stage.name());
        } catch (Exception ex) {
            return new ActionResult(false, "set_deal_stage failed: invalid stage " + targetStage);
        }
    }

    private ActionResult setLeadStatus(String leadId, String statusText) {
        if (!StringUtils.hasText(leadId)) return new ActionResult(false, "set_lead_status skipped: leadId missing in context");
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId()).orElse(null);
        if (lead == null) return new ActionResult(false, "set_lead_status skipped: lead not found");
        try {
            Lead.LeadStatus status = Lead.LeadStatus.valueOf(statusText);
            lead.setStatus(status);
            leadRepository.save(lead);
            return new ActionResult(true, "Lead status updated to " + status.name());
        } catch (Exception ex) {
            return new ActionResult(false, "set_lead_status failed: invalid status " + statusText);
        }
    }

    private ActionResult setLeadScore(String leadId, String scoreText) {
        if (!StringUtils.hasText(leadId)) return new ActionResult(false, "set_lead_score skipped: leadId missing in context");
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId()).orElse(null);
        if (lead == null) return new ActionResult(false, "set_lead_score skipped: lead not found");
        try {
            Lead.LeadScore score = Lead.LeadScore.valueOf(scoreText);
            lead.setScore(score);
            leadRepository.save(lead);
            return new ActionResult(true, "Lead score updated to " + score.name());
        } catch (Exception ex) {
            return new ActionResult(false, "set_lead_score failed: invalid score " + scoreText);
        }
    }

    private ActionResult assignLead(String leadId, String assigneeToken) {
        if (!StringUtils.hasText(leadId)) return new ActionResult(false, "assign_lead skipped: leadId missing in context");
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId()).orElse(null);
        if (lead == null) return new ActionResult(false, "assign_lead skipped: lead not found");

        User assignee = null;
        if (StringUtils.hasText(assigneeToken)) {
            assignee = assigneeToken.contains("@")
                ? userRepository.findByEmailAndTenantIdAndDeletedFalse(assigneeToken, tenantId()).orElse(null)
                : userRepository.findByIdAndTenantIdAndDeletedFalse(assigneeToken, tenantId()).orElse(null);
        }
        if (assignee == null) {
            assignee = userRepository.findByTenantIdAndDeletedFalse(tenantId()).stream()
                .filter(u -> Boolean.TRUE.equals(u.getIsActive()))
                .filter(u -> User.isSalesLike(u.getRole()) || u.getRole() == User.Role.MANAGER)
                .findFirst()
                .orElse(null);
        }
        if (assignee == null) return new ActionResult(false, "assign_lead skipped: no active assignee found");

        lead.setAssignedTo(assignee);
        leadRepository.save(lead);
        if (StringUtils.hasText(assignee.getEmail())) {
            notificationPublisher.notifyLeadAssigned(assignee.getEmail(), lead.getName());
        }
        return new ActionResult(true, "Lead assigned to " + (StringUtils.hasText(assignee.getName()) ? assignee.getName() : assignee.getEmail()));
    }

    private ActionResult sendEmailAction(String payload, String workflowName, String trigger) {
        String[] parts = payload.split("\\|", 3);
        if (parts.length < 3) return new ActionResult(false, "send_email skipped: expected 'recipient|subject|body'");
        String recipient = normalize(parts[0]);
        String subject = normalize(parts[1]);
        String body = normalize(parts[2]);
        if (!StringUtils.hasText(recipient) || !recipient.contains("@")) return new ActionResult(false, "send_email skipped: invalid recipient");
        EmailSendRequest request = new EmailSendRequest();
        request.setTo(recipient);
        request.setSubject(StringUtils.hasText(subject) ? subject : "Workflow Notification");
        request.setBody(StringUtils.hasText(body) ? body : ("Workflow: " + workflowName + ", trigger: " + trigger));
        communicationService.sendEmail(request);
        return new ActionResult(true, "Email sent to " + recipient);
    }

    private ActionResult sendCallAction(String payload, Map<String, Object> context) {
        String[] parts = payload.split("\\|", 4);
        String recipient = normalize(parts.length > 0 ? parts[0] : "");
        String script = normalize(parts.length > 1 ? parts[1] : "");
        String setup = normalize(parts.length > 2 ? parts[2] : "");
        String fromNumber = normalize(parts.length > 3 ? parts[3] : "");
        if (!StringUtils.hasText(recipient)) {
            recipient = normalize((String) context.get("leadPhone"));
        }
        if (!StringUtils.hasText(recipient)) {
            return new ActionResult(false, "send_call skipped: recipient phone missing");
        }
        if (!StringUtils.hasText(script)) {
            script = "Hello, this is NexaCRM calling about your enquiry.";
        }
        String leadId = normalize((String) context.get("leadId"));
        String leadName = normalize((String) context.get("leadName"));
        Map<String, Object> metadata = new LinkedHashMap<>();
        if (StringUtils.hasText(setup)) {
            metadata.put("setup", setup);
            metadata.put("provider", setup);
        }
        if (StringUtils.hasText(fromNumber)) {
            metadata.put("fromNumber", fromNumber);
        }
        communicationService.sendLeadVoiceCall(leadId, leadName, recipient, script, "workflow_automation", metadata);
        return new ActionResult(true, "Call queued to " + recipient + (StringUtils.hasText(setup) ? " via " + setup : ""));
    }

    private ActionResult sendWhatsAppAction(String payload, Map<String, Object> context) {
        String[] parts = payload.split("\\|", 2);
        String recipient = normalize(parts.length > 0 ? parts[0] : "");
        String message = normalize(parts.length > 1 ? parts[1] : "");
        if (!StringUtils.hasText(recipient)) {
            recipient = normalize((String) context.get("leadPhone"));
        }
        if (!StringUtils.hasText(recipient)) {
            return new ActionResult(false, "send_whatsapp skipped: recipient phone missing");
        }
        if (!StringUtils.hasText(message)) {
            String leadName = normalize((String) context.get("leadName"));
            message = StringUtils.hasText(leadName)
                ? "Hi " + leadName + ", thank you for your interest! We will get back to you shortly."
                : "Hi, thank you for your interest! We will get back to you shortly.";
        }
        // Replace {{name}} placeholder with lead name from context
        String leadName = normalize((String) context.get("leadName"));
        if (StringUtils.hasText(leadName)) {
            message = message.replace("{{name}}", leadName);
        } else {
            message = message.replace("{{name}}", "there");
        }
        communicationService.sendChannelMessage("whatsapp", recipient, "", message);
        return new ActionResult(true, "WhatsApp sent to " + recipient);
    }

    private ActionResult notifyAction(String message, String workflowName, String trigger) {
        String finalMsg = StringUtils.hasText(message) ? message : ("Workflow executed: " + workflowName);
        notificationPublisher.broadcast(Map.of(
            "type", "WORKFLOW",
            "title", workflowName,
            "message", finalMsg,
            "trigger", trigger,
            "timestamp", System.currentTimeMillis()
        ));
        return new ActionResult(true, "Notification broadcasted");
    }

    private Long tenantId() {
        return TenantContext.currentTenantId();
    }

    private String waitStep(String waitText) {
        long waitMillis = parseWaitMillis(waitText);
        if (waitMillis <= 0) {
            return "WAIT skipped: unable to parse duration '" + waitText + "'";
        }
        sleepSafely(waitMillis);
        return "WAIT completed: " + waitText;
    }

    private long parseWaitMillis(String waitText) {
        String value = normalize(waitText).toLowerCase(Locale.ROOT);
        var matcher = Pattern.compile("^(\\d+)\\s*(ms|millisecond|milliseconds|s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$")
            .matcher(value);
        if (!matcher.matches()) return -1L;

        long amount = Long.parseLong(matcher.group(1));
        String unit = matcher.group(2);

        return switch (unit) {
            case "ms", "millisecond", "milliseconds" -> amount;
            case "s", "sec", "second", "seconds" -> amount * 1_000L;
            case "m", "min", "minute", "minutes" -> amount * 60_000L;
            case "h", "hr", "hour", "hours" -> amount * 3_600_000L;
            case "d", "day", "days" -> amount * 86_400_000L;
            default -> -1L;
        };
    }

    private void sleepSafely(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Workflow wait interrupted", ie);
        }
    }

    private String extractStageFromText(String lowerText) {
        for (String stage : STAGES) {
            String token = stage.toLowerCase(Locale.ROOT);
            Pattern p = Pattern.compile("(stage\\s*(is|=|to)?\\s*" + token + ")|(moved\\s*to\\s*" + token + ")|(to\\s*" + token + "\\s*stage)");
            if (p.matcher(lowerText).find()) {
                return stage;
            }
        }
        return null;
    }

    private void saveRunLog(Workflow workflow, String trigger, String status, String message) {
        WorkflowRunLog runLog = WorkflowRunLog.builder()
            .workflowId(workflow.getId())
            .workflowName(workflow.getName())
            .trigger(trigger)
            .status(status)
            .message(message)
            .runAt(LocalDateTime.now())
            .build();
        runLog.setTenantId(tenantId());
        workflowRunLogRepository.save(runLog);
    }

    private List<Long> resolveTenantIds() {
        LinkedHashSet<Long> tenantIds = new LinkedHashSet<>();
        tenantIds.addAll(distinctTenantIds("workflows"));
        tenantIds.addAll(distinctTenantIds("leads"));
        tenantIds.addAll(distinctTenantIds("invoices"));
        tenantIds.addAll(distinctTenantIds("deals"));
        return tenantIds.stream().filter(Objects::nonNull).distinct().toList();
    }

    private List<Long> distinctTenantIds(String collectionName) {
        try {
            return mongoTemplate.findDistinct(
                new Query(Criteria.where("deleted").is(false)),
                "tenant_id",
                collectionName,
                Long.class
            );
        } catch (Exception ex) {
            log.warn("Unable to enumerate tenant ids from {}: {}", collectionName, ex.getMessage());
            return List.of();
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private String firstNonBlank(String... values) {
        return Arrays.stream(values)
            .filter(StringUtils::hasText)
            .findFirst()
            .orElse("");
    }

    @Scheduled(cron = "0 0 * * * *")
    public void checkFollowUps() {
        LocalDateTime threshold = LocalDateTime.now().minus(24, ChronoUnit.HOURS);
        for (Long tenant : resolveTenantIds()) {
            TenantContext.setCurrentTenantId(tenant);
            try {
                List<Lead> leads = leadRepository.findByTenantIdAndDeletedFalse(tenant).stream()
                    .filter(lead -> lead.getStatus() != Lead.LeadStatus.WON && lead.getStatus() != Lead.LeadStatus.LOST)
                    .filter(lead -> lead.getLastContactedAt() == null || lead.getLastContactedAt().isBefore(threshold))
                    .toList();

                for (Lead lead : leads) {
                    if (!StringUtils.hasText(lead.getId())) continue;
                    processEvent("FOLLOW_UP_DUE", Map.of(
                        "leadId", lead.getId(),
                        "leadEmail", normalize(lead.getEmail()),
                        "status", lead.getStatus() != null ? lead.getStatus().name() : "",
                        "lastContactedAt", lead.getLastContactedAt() != null ? lead.getLastContactedAt().toString() : ""
                    ));
                }
                log.info("Follow-up sweep complete for tenant {}. Triggered {} FOLLOW_UP_DUE events", tenant, leads.size());
            } finally {
                TenantContext.clear();
            }
        }
    }

    @Scheduled(cron = "0 0 9 * * *")
    public void checkOverdueInvoices() {
        var overdueStatuses = List.of(Invoice.InvoiceStatus.SENT, Invoice.InvoiceStatus.PENDING);
        for (Long tenant : resolveTenantIds()) {
            TenantContext.setCurrentTenantId(tenant);
            try {
                var overdueInvoices = invoiceRepository.findByTenantIdAndDeletedFalseAndStatusInAndDueDateBefore(
                    tenant,
                    overdueStatuses,
                    java.time.LocalDate.now()
                );

                for (Invoice invoice : overdueInvoices) {
                    if (!StringUtils.hasText(invoice.getId())) continue;
                    processEvent("INVOICE_OVERDUE", Map.of(
                        "invoiceId", invoice.getId(),
                        "invoiceNumber", normalize(invoice.getInvoiceNumber()),
                        "status", invoice.getStatus() != null ? invoice.getStatus().name() : "",
                        "dueDate", invoice.getDueDate() != null ? invoice.getDueDate().toString() : ""
                    ));
                }
                log.info("Invoice sweep complete for tenant {}. Triggered {} INVOICE_OVERDUE events", tenant, overdueInvoices.size());
            } finally {
                TenantContext.clear();
            }
        }
    }

    @Scheduled(cron = "0 0 7 * * *")
    public void rescoreLeads() {
        for (Long tenant : resolveTenantIds()) {
            TenantContext.setCurrentTenantId(tenant);
            try {
                List<Lead> leads = leadRepository.findByTenantIdAndDeletedFalse(tenant);
                for (Lead lead : leads) {
                    if (!StringUtils.hasText(lead.getId())) continue;
                    processEvent("LEAD_SCORE_CHANGED", Map.of(
                        "leadId", lead.getId(),
                        "score", lead.getScore() != null ? lead.getScore().name() : "",
                        "source", lead.getSource() != null ? lead.getSource().name() : ""
                    ));
                }
                log.info("Lead rescore sweep complete for tenant {}. Triggered {} LEAD_SCORE_CHANGED events", tenant, leads.size());
            } finally {
                TenantContext.clear();
            }
        }
    }

    private record ActionResult(boolean executed, String note) { }

    private record ExecutionOutcome(boolean conditionMatched, int executedActions, List<String> notes) { }
}
