package com.nexacrm.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexacrm.exception.ResourceNotFoundException;
import com.nexacrm.model.CommunicationRecord;
import com.nexacrm.model.Deal;
import com.nexacrm.model.Lead;
import com.nexacrm.model.LeadActivity;
import com.nexacrm.model.User;
import com.nexacrm.repository.CommunicationRecordRepository;
import com.nexacrm.repository.DealRepository;
import com.nexacrm.repository.LeadActivityRepository;
import com.nexacrm.repository.LeadRepository;
import com.nexacrm.repository.TenantRepository;
import com.nexacrm.repository.UserRepository;
import com.nexacrm.security.TenantContext;
import com.nexacrm.websocket.NotificationPublisher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class CallAgentService {

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
    private static final List<String> CONNECTED_TERMINAL_STATUSES = List.of(
        "COMPLETED",
        "CONNECTED",
        "ANSWERED",
        "SUCCESS"
    );

    private Long tenantId() {
        return TenantContext.currentTenantId();
    }

    private final CommunicationRecordRepository communicationRecordRepository;
    private final DealRepository dealRepository;
    private final LeadRepository leadRepository;
    private final LeadChangeAuditService leadChangeAuditService;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final LeadActivityRepository leadActivityRepository;
    private final CommunicationService communicationService;
    private final LeadCallAutomationService leadCallAutomationService;
    private final IntegrationService integrationService;
    private final AIService aiService;
    private final NotificationPublisher notificationPublisher;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    @Value("${nexacrm.call-agent.webhook-secret:}")
    private String defaultWebhookSecret;

    @Value("${nexacrm.call-agent.bolna.api-url:https://api.bolna.ai}")
    private String defaultBolnaApiUrl;

    @Value("${nexacrm.call-agent.bolna.api-key:}")
    private String defaultBolnaApiKey;

    @Transactional(readOnly = true)
    public boolean isWebhookAuthorized(String secretHeader, String authorizationHeader, Map<String, Object> payload) {
        Map<String, Object> metadata = readMetadata(payload);
        String payloadSecret = trim(stringValue(payload.get("secret")));
        if (payloadSecret.isBlank()) {
            payloadSecret = trim(stringValue(payload.get("webhookSecret")));
        }

        String bearer = trim(authorizationHeader);
        if (bearer.toLowerCase(Locale.ROOT).startsWith("bearer ")) {
            bearer = trim(bearer.substring("bearer ".length()));
        }

        if (trim(secretHeader).isBlank() && payloadSecret.isBlank() && bearer.isBlank()) {
            return false;
        }

        boolean tenantSetForWebhook = false;
        if (TenantContext.currentTenantIdOrNull() == null) {
            Long resolvedTenantId = firstLong(
                payload.get("tenantId"),
                payload.get("tenant_id"),
                metadata.get("tenantId"),
                metadata.get("tenant_id")
            );
            if (resolvedTenantId != null) {
                TenantContext.setCurrentTenantId(resolvedTenantId);
                tenantSetForWebhook = true;
            }
        }

        try {
            String expectedSecret = trim(defaultWebhookSecret);
            if (TenantContext.currentTenantIdOrNull() != null) {
                expectedSecret = firstNonBlank(
                    trim(integrationService.getConfig("voice_call_agent").get("webhookSecret")),
                    expectedSecret
                );
            }
            if (expectedSecret.isBlank()) {
                log.warn("Call agent webhook rejected because nexacrm.call-agent.webhook-secret is not configured");
                return false;
            }

            return expectedSecret.equals(trim(secretHeader))
                || expectedSecret.equals(payloadSecret)
                || expectedSecret.equals(bearer);
        } finally {
            if (tenantSetForWebhook) {
                TenantContext.clear();
            }
        }
    }

    public Map<String, Object> processWebhook(Map<String, Object> payload) {
        Map<String, Object> metadata = readMetadata(payload);

        String externalId = firstNonBlank(
            stringValue(payload.get("CallSid")),
            stringValue(payload.get("callSid")),
            stringValue(payload.get("externalId")),
            stringValue(payload.get("external_id")),
            stringValue(payload.get("callId")),
            stringValue(payload.get("call_id")),
            stringValue(payload.get("sipCallId")),
            stringValue(payload.get("sip_call_id")),
            stringValue(payload.get("sip.callID")),
            stringValue(payload.get("executionId")),
            stringValue(payload.get("execution_id")),
            stringValue(payload.get("id"))
        );
        String leadId = firstNonBlank(
            stringValue(payload.get("leadId")),
            stringValue(payload.get("lead_id")),
            stringValue(metadata.get("leadId")),
            stringValue(metadata.get("lead_id"))
        );
        String status = normalizeStatus(firstNonBlank(
            stringValue(payload.get("CallStatus")),
            stringValue(payload.get("callStatus")),
            stringValue(payload.get("status")),
            stringValue(payload.get("call_status")),
            stringValue(payload.get("event")),
            stringValue(payload.get("state"))
        ));
        String outcome = normalizeOutcome(firstNonBlank(
            stringValue(payload.get("outcome")),
            stringValue(payload.get("callOutcome")),
            stringValue(payload.get("call_outcome")),
            stringValue(payload.get("disposition")),
            stringValue(payload.get("result"))
        ));
        String transcript = extractTranscript(payload, metadata);
        String summary = firstNonBlank(
            stringValue(payload.get("summary")),
            stringValue(payload.get("note")),
            stringValue(payload.get("message")),
            stringValue(payload.get("recording_url"))
        );
        if (summary.isBlank() && !transcript.isBlank()) {
            summary = transcript.length() > 320 ? transcript.substring(0, 320) + "..." : transcript;
        }

        Optional<CommunicationRecord> callRecord = Optional.empty();
        if (!externalId.isBlank()) {
            callRecord = communicationRecordRepository
                .findFirstByChannelIgnoreCaseAndExternalIdOrderByCreatedAtDesc("CALL", externalId);
        }
        if (callRecord.isEmpty() && !leadId.isBlank()) {
            List<CommunicationRecord> leadCalls = communicationRecordRepository
                .findTop50ByLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(leadId, "CALL");
            if (!leadCalls.isEmpty()) {
                callRecord = Optional.of(leadCalls.get(0));
            }
        }

        if (callRecord.isPresent()) {
            CommunicationRecord record = callRecord.get();
            if (!externalId.isBlank() && trim(record.getExternalId()).isBlank()) {
                record.setExternalId(externalId);
            }
            if (!status.isBlank()) {
                record.setStatus(status);
            }
            if (!leadId.isBlank() && trim(record.getLeadId()).isBlank()) {
                record.setLeadId(leadId);
            }
            String rawPayload = toJson(payload);
            if (!rawPayload.isBlank()) {
                record.setRawPayload(rawPayload);
            }
            communicationRecordRepository.save(record);
            if (leadId.isBlank()) {
                leadId = trim(record.getLeadId());
            }
        }

        boolean tenantSetForWebhook = false;
        if (TenantContext.currentTenantIdOrNull() == null) {
            Long resolvedTenantId = callRecord
                .map(CommunicationRecord::getTenantId)
                .orElseGet(() -> firstLong(
                    payload.get("tenantId"),
                    payload.get("tenant_id"),
                    metadata.get("tenantId"),
                    metadata.get("tenant_id")
                ));
            if (resolvedTenantId != null) {
                TenantContext.setCurrentTenantId(resolvedTenantId);
                tenantSetForWebhook = true;
            }
        }

        try {
        Lead lead = null;
        if (!leadId.isBlank()) {
            lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId())
                .orElse(null);
        }

        String hotSignal = resolveHotSignal(payload, metadata, outcome);
        boolean assignedLead = false;
        if (lead != null) {
            Map<String, Object> currentCallRow = buildWebhookAnalysisCallRow(lead, externalId, status, outcome, summary, transcript, payload);
            summary = trim(stringValue(currentCallRow.get("summary")));
            transcript = trim(stringValue(currentCallRow.get("transcript")));
            if (!status.isBlank() && "NEW".equalsIgnoreCase(lead.getStatus().name()) && isConnectedStatus(status)) {
                lead.setStatus(Lead.LeadStatus.CONTACTED);
            }
            if (isConnectedStatus(status) || !outcome.isBlank()) {
                lead.setLastContactedAt(LocalDateTime.now());
            }

            Lead.ExpectedCloseTimeline detectedTimeline = resolveTimelineFromPayload(payload, metadata, outcome);
            if (detectedTimeline != null) {
                lead.setExpectedCloseTimeline(detectedTimeline);
                lead.setScore(switch (detectedTimeline) {
                    case DAYS_1_3 -> Lead.LeadScore.HOT;
                    case DAYS_7_10 -> Lead.LeadScore.WARM;
                    case DAYS_10_15_PLUS -> Lead.LeadScore.COLD;
                });
                if (detectedTimeline == Lead.ExpectedCloseTimeline.DAYS_1_3) {
                    if (lead.getStatus() == Lead.LeadStatus.NEW || lead.getStatus() == Lead.LeadStatus.CONTACTED) {
                        lead.setStatus(Lead.LeadStatus.QUALIFIED);
                    }
                    assignedLead = assignIfUnassigned(lead);
                }
            } else if ("HOT".equals(hotSignal)) {
                lead.setScore(Lead.LeadScore.HOT);
                if (lead.getStatus() == Lead.LeadStatus.NEW || lead.getStatus() == Lead.LeadStatus.CONTACTED) {
                    lead.setStatus(Lead.LeadStatus.QUALIFIED);
                }
                assignedLead = assignIfUnassigned(lead);
            } else if ("WARM".equals(hotSignal) && lead.getScore() == Lead.LeadScore.COLD) {
                lead.setScore(Lead.LeadScore.WARM);
            }
            leadChangeAuditService.save(lead);
            saveLeadCallActivity(lead, status, outcome, externalId, summary, transcript, payload);
            applyCallIntelligenceToLead(lead, currentCallRow);
        }

        String resolvedLeadId = lead != null ? lead.getId() : leadId;
        try {
            leadCallAutomationService.handleCallResult(
                resolvedLeadId,
                status,
                outcome,
                extractDurationSeconds(payload, metadata),
                externalId
            );
        } catch (Exception ex) {
            log.warn("Could not update automated call workflow for lead {}: {}", resolvedLeadId, ex.getMessage());
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ok", true);
        response.put("externalId", externalId);
        response.put("leadId", lead != null ? lead.getId() : leadId);
        response.put("status", status);
        response.put("outcome", outcome);
        response.put("transcript", transcript);
        response.put("assignedHotLead", assignedLead);
        return response;
        } finally {
            if (tenantSetForWebhook) {
                TenantContext.clear();
            }
        }
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getLeadCallHistory(String leadId) {
        Lead lead = ensureLeadExists(leadId);
        List<CommunicationRecord> calls = communicationRecordRepository
            .findTop50ByLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(leadId, "CALL");
        Optional<com.nexacrm.model.LeadCallAutomation> workflow = leadCallAutomationService.findForLead(leadId);
        List<Map<String, Object>> rows = new ArrayList<>();
        int total = calls.size();
        for (int i = 0; i < calls.size(); i++) {
            Map<String, Object> row = toCallHistoryRow(calls.get(i));
            row.put("leadName", lead.getName());
            row.put("contactNumber", lead.getPhone());
            row.put("leadSource", lead.getSource() != null ? lead.getSource().name() : "OTHER");
            row.put("attemptNumber", resolveAttemptNumber(row, total - i));
            row.put("callDateTime", row.get("createdAt"));
            row.put("callStatus", row.get("status"));
            row.put("callDuration", row.get("durationSeconds"));
            row.put("nextScheduledAttempt", workflow.map(com.nexacrm.model.LeadCallAutomation::getNextScheduledAt).orElse(null));
            rows.add(row);
        }
        return rows;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getRecentCalls() {
        return communicationRecordRepository
            .findByTenantIdAndChannelIgnoreCaseOrderByCreatedAtDesc(
                tenantId(),
                "CALL",
                org.springframework.data.domain.PageRequest.of(0, 30)
            )
            .stream()
            .map(this::toCallHistoryRow)
            .toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getLeadCallIntelligence(String leadId) {
        Lead lead = ensureLeadExists(leadId);
        List<CommunicationRecord> calls = communicationRecordRepository
            .findTop50ByLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(leadId, "CALL");

        List<Map<String, Object>> history = calls.stream()
            .map(this::toCallHistoryRow)
            .toList();

        List<Map<String, Object>> sampleForAnalysis = buildAiAnalysisWindow(history, null);

        Map<String, Object> analysis = calls.isEmpty()
            ? Map.of(
                "leadVerdict", "UNCERTAIN",
                "suggestedLeadStatus", lead.getStatus() != null ? lead.getStatus().name() : "NEW",
                "confidence", 0,
                "summary", "No call history is available for this lead yet.",
                "reasoning", "The AI model needs at least one call transcript or execution record to make a call-quality verdict.",
                "positiveSignals", List.of(),
                "riskSignals", List.of("No call data available"),
                "nextBestAction", "Place or sync a call to analyze conversation quality."
            )
            : aiService.analyzeCallIntelligence(lead, sampleForAnalysis);

        Map<String, Object> leadSnapshot = new LinkedHashMap<>();
        leadSnapshot.put("id", lead.getId());
        leadSnapshot.put("name", lead.getName());
        leadSnapshot.put("email", lead.getEmail());
        leadSnapshot.put("phone", lead.getPhone());
        leadSnapshot.put("company", lead.getCompany());
        leadSnapshot.put("status", lead.getStatus() != null ? lead.getStatus().name() : "");
        leadSnapshot.put("score", lead.getScore() != null ? lead.getScore().name() : "");
        leadSnapshot.put("source", lead.getSource() != null ? lead.getSource().name() : "");
        leadSnapshot.put("aiScoreValue", lead.getAiScoreValue());
        leadSnapshot.put("aiNextAction", lead.getAiNextAction());
        leadSnapshot.put("lastContactedAt", lead.getLastContactedAt());

        return Map.of(
            "lead", leadSnapshot,
            "calls", history,
            "analysis", analysis
        );
    }

    public Map<String, Object> getCallOptions() {
        return communicationService.getCallOptions();
    }

    public Map<String, Object> retryCall(String callId) {
        return retryCall(callId, null, null);
    }

    public Map<String, Object> retryCall(String callId, String setup, String fromNumber) {
        CommunicationRecord record = communicationRecordRepository
            .findByIdAndChannelIgnoreCase(callId, "CALL")
            .orElseThrow(() -> new ResourceNotFoundException("Call record not found: " + callId));

        String phone = trim(record.getContactIdentifier());
        if (phone.isBlank()) {
            throw new IllegalStateException("Cannot retry call without phone number.");
        }

        Lead lead = null;
        String leadId = trim(record.getLeadId());
        if (!leadId.isBlank()) {
            lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId()).orElse(null);
        }

        String leadName = lead != null ? trim(lead.getName()) : "";
        String script = trim(record.getBody());
        if (script.isBlank()) {
            script = "Hello, this is NexaCRM. We are calling to follow up on your enquiry.";
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("retryOfCallId", record.getId());
        if (!trim(record.getExternalId()).isBlank()) {
            metadata.put("previousExternalId", trim(record.getExternalId()));
        }
        if (setup != null && !setup.isBlank()) {
            metadata.put("setup", setup.trim());
            metadata.put("provider", setup.trim());
        }
        if (fromNumber != null && !fromNumber.isBlank()) {
            metadata.put("fromNumber", fromNumber.trim());
        }

        communicationService.sendLeadVoiceCall(
            leadId,
            leadName,
            phone,
            script,
            "retry_call",
            metadata
        );

        if (lead != null) {
            lead.setLastContactedAt(LocalDateTime.now());
            leadChangeAuditService.save(lead);
        }

        return Map.of(
            "ok", true,
            "message", "Call retried successfully",
            "callId", record.getId(),
            "leadId", leadId,
            "phone", phone,
            "setup", setup != null ? setup : "",
            "fromNumber", fromNumber != null ? fromNumber : ""
        );
    }

    public Map<String, Object> makeDirectCall(
        String toNumber,
        String fromNumber,
        String agentNumber,
        String leadId,
        String leadName
    ) {
        CommunicationService.VoiceAgentConfig config = communicationService.resolveVoiceAgentConfig();
        String accountSid = trim(config.twilioAccountSid());
        String authToken = trim(config.twilioAuthToken());
        String callerId = firstNonBlank(fromNumber, config.twilioFromNumber(), config.fromNumber());

        if (accountSid.isBlank() || authToken.isBlank()) {
            throw new IllegalStateException("Twilio integration is not configured. Please add your Twilio Account SID and Auth Token in Integrations.");
        }
        if (callerId.isBlank()) {
            throw new IllegalStateException("Twilio caller phone number (From) is required. Please select or configure a Twilio number.");
        }

        String normalizedTo = communicationService.normalizePhoneForCall(toNumber);
        if (normalizedTo.isBlank()) {
            throw new IllegalStateException("Recipient phone number (To) is required.");
        }

        String normalizedAgent = trim(agentNumber).isBlank() ? "" : communicationService.normalizePhoneForCall(agentNumber);

        String twilioUrl = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Calls.json";
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(accountSid, authToken);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        org.springframework.util.MultiValueMap<String, String> form = new org.springframework.util.LinkedMultiValueMap<>();

        String twiml;
        if (!normalizedAgent.isBlank()) {
            form.add("To", normalizedAgent);
            form.add("From", callerId);
            twiml = "<Response>"
                + "<Say voice=\"alice\">Connecting your call to " + communicationService.escapeXml(normalizedTo) + " from your Twilio line.</Say>"
                + "<Dial callerId=\"" + communicationService.escapeXml(callerId) + "\" record=\"record-from-answer\" timeout=\"45\">"
                + "<Number>" + communicationService.escapeXml(normalizedTo) + "</Number>"
                + "</Dial>"
                + "</Response>";
        } else {
            form.add("To", normalizedTo);
            form.add("From", callerId);
            twiml = "<Response>"
                + "<Say voice=\"alice\">Hello, this is a call from NexaCRM. Please wait while an agent connects.</Say>"
                + "</Response>";
        }

        form.add("Twiml", twiml);
        String callbackWebhookUrl = communicationService.resolveCallAgentWebhookUrl(config);
        if (!callbackWebhookUrl.isBlank()) {
            form.add("StatusCallback", callbackWebhookUrl);
            form.add("StatusCallbackMethod", "POST");
        }

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                twilioUrl,
                HttpMethod.POST,
                new HttpEntity<>(form, headers),
                Map.class
            );

            Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
            String externalId = trim(String.valueOf(body.get("sid")));
            String status = normalizeStatus(String.valueOf(body.get("status")));
            if (status.isBlank()) status = "INITIATED";

            Map<String, Object> raw = new LinkedHashMap<>();
            raw.put("provider", "twilio_direct");
            raw.put("from", callerId);
            raw.put("to", normalizedTo);
            raw.put("agentPhone", normalizedAgent);
            raw.put("response", body);

            String callBodyDesc = "Direct 2-way call to " + normalizedTo + " from Twilio number " + callerId;
            if (!normalizedAgent.isBlank()) {
                callBodyDesc += " (Bridged with agent phone " + normalizedAgent + ")";
            }

            String effectiveLeadName = trim(leadName);
            String effectiveLeadId = trim(leadId);

            if (!effectiveLeadId.isBlank() && effectiveLeadName.isBlank()) {
                leadRepository.findByIdAndTenantIdAndDeletedFalse(effectiveLeadId, tenantId())
                    .ifPresent(l -> {
                        if (l.getName() != null) {
                            effectiveLeadName.concat(l.getName());
                        }
                    });
            }

            communicationService.tryPersistCommunication(
                "CALL",
                "OUT",
                normalizedTo,
                callBodyDesc,
                status,
                externalId,
                toJson(raw),
                "twilio_direct",
                effectiveLeadName,
                effectiveLeadId
            );

            if (!effectiveLeadId.isBlank()) {
                Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(effectiveLeadId, tenantId()).orElse(null);
                if (lead != null) {
                    lead.setLastContactedAt(LocalDateTime.now());
                    if (lead.getStatus() == Lead.LeadStatus.NEW) {
                        lead.setStatus(Lead.LeadStatus.CONTACTED);
                    }
                    leadChangeAuditService.save(lead);

                    var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
                    String actor = (auth != null && auth.getPrincipal() instanceof User u && u.getEmail() != null)
                        ? u.getEmail() : "agent";

                    LeadActivity activity = LeadActivity.builder()
                        .leadId(lead.getId())
                        .activityIndex(0)
                        .activityId("act_call")
                        .activityLabel("Direct Call")
                        .activityTitle("Direct Twilio Call")
                        .assignedTo(actor)
                        .summary("Direct call to " + normalizedTo + " from " + callerId + (!normalizedAgent.isBlank() ? " (Bridged with " + normalizedAgent + ")" : ""))
                        .values(Map.of("channel", "twilio_direct", "status", status, "phone", normalizedTo))
                        .savedAt(LocalDateTime.now())
                        .build();
                    activity.setTenantId(tenantId());
                    leadActivityRepository.save(activity);
                }
            }

            notificationPublisher.broadcast(
                Map.of(
                    "type", "CALL",
                    "callSid", externalId,
                    "status", status,
                    "toNumber", normalizedTo,
                    "fromNumber", callerId,
                    "agentNumber", normalizedAgent,
                    "leadId", effectiveLeadId
                )
            );

            return Map.of(
                "ok", true,
                "callSid", externalId,
                "status", status,
                "toNumber", normalizedTo,
                "fromNumber", callerId,
                "agentNumber", normalizedAgent,
                "message", !normalizedAgent.isBlank()
                    ? "Twilio is ringing your phone (" + normalizedAgent + ") first! Pick up to connect directly with " + normalizedTo + "."
                    : "Direct Twilio call placed to " + normalizedTo + " from " + callerId
            );
        } catch (HttpStatusCodeException ex) {
            String apiBody = trim(ex.getResponseBodyAsString());
            log.error("Twilio API direct call error: {}", apiBody);
            throw new IllegalStateException("Twilio error (" + ex.getStatusCode().value() + "): " + (apiBody.isBlank() ? ex.getMessage() : apiBody));
        } catch (Exception ex) {
            log.error("Failed to initiate direct Twilio call", ex);
            throw new IllegalStateException("Failed to place direct call: " + ex.getMessage());
        }
    }

    public Map<String, Object> hangupCall(String callSid) {
        if (callSid == null || callSid.isBlank()) {
            throw new IllegalArgumentException("Call SID is required.");
        }
        CommunicationService.VoiceAgentConfig config = communicationService.resolveVoiceAgentConfig();
        String accountSid = trim(config.twilioAccountSid());
        String authToken = trim(config.twilioAuthToken());

        if (accountSid.isBlank() || authToken.isBlank()) {
            throw new IllegalStateException("Twilio integration is not configured.");
        }

        String twilioUrl = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Calls/" + callSid.trim() + ".json";
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(accountSid, authToken);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        org.springframework.util.MultiValueMap<String, String> form = new org.springframework.util.LinkedMultiValueMap<>();
        form.add("Status", "completed");

        try {
            restTemplate.exchange(twilioUrl, HttpMethod.POST, new HttpEntity<>(form, headers), Map.class);
        } catch (Exception ex) {
            log.warn("Twilio hangup returned: {}", ex.getMessage());
        }

        communicationRecordRepository
            .findFirstByChannelIgnoreCaseAndExternalIdOrderByCreatedAtDesc("CALL", callSid.trim())
            .ifPresent(record -> {
                record.setStatus("COMPLETED");
                communicationRecordRepository.save(record);
            });

        return Map.of("ok", true, "callSid", callSid.trim(), "message", "Call terminated successfully");
    }

    public Map<String, Object> getCallStatus(String callSid) {
        if (callSid == null || callSid.isBlank()) {
            throw new IllegalArgumentException("Call SID is required.");
        }
        CommunicationService.VoiceAgentConfig config = communicationService.resolveVoiceAgentConfig();
        String accountSid = trim(config.twilioAccountSid());
        String authToken = trim(config.twilioAuthToken());

        if (accountSid.isBlank() || authToken.isBlank()) {
            throw new IllegalStateException("Twilio integration is not configured.");
        }

        String twilioUrl = "https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Calls/" + callSid.trim() + ".json";
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(accountSid, authToken);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(twilioUrl, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            Map<?, ?> body = response.getBody() == null ? Map.of() : response.getBody();
            String status = normalizeStatus(String.valueOf(body.get("status")));
            String duration = String.valueOf(body.get("duration"));

            communicationRecordRepository
                .findFirstByChannelIgnoreCaseAndExternalIdOrderByCreatedAtDesc("CALL", callSid.trim())
                .ifPresent(record -> {
                    if (!status.isBlank()) {
                        record.setStatus(status);
                        communicationRecordRepository.save(record);
                    }
                });

            return Map.of(
                "ok", true,
                "callSid", callSid.trim(),
                "status", status,
                "duration", duration != null && !duration.equals("null") ? duration : "0",
                "price", String.valueOf(body.get("price")),
                "to", String.valueOf(body.get("to")),
                "from", String.valueOf(body.get("from"))
            );
        } catch (Exception ex) {
            return Map.of("ok", false, "callSid", callSid.trim(), "error", ex.getMessage());
        }
    }

    /**
     * Trigger call intelligence analysis + WhatsApp notifications for a lead.
     * Called by the scheduler when it detects a connected/completed call via Bolna polling,
     * as a belt-and-suspenders fallback for when the webhook callback path is missed.
     */
    public void triggerCallIntelligenceForLead(String leadId) {
        String normalizedLeadId = trim(leadId);
        if (normalizedLeadId.isBlank()) return;
        Lead lead = leadRepository.findByIdAndTenantIdAndDeletedFalse(normalizedLeadId, tenantId()).orElse(null);
        if (lead == null) return;
        try {
            applyCallIntelligenceToLead(lead, null);
        } catch (Exception ex) {
            log.warn("Scheduled call intelligence failed for lead {}: {}", normalizedLeadId, ex.getMessage());
        }
    }

    private Lead ensureLeadExists(String leadId) {
        return leadRepository.findByIdAndTenantIdAndDeletedFalse(leadId, tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Lead not found: " + leadId));
    }

    private Map<String, Object> readMetadata(Map<String, Object> payload) {
        Object metadata = payload.get("metadata");
        if (metadata instanceof Map<?, ?> map) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            map.forEach((k, v) -> normalized.put(String.valueOf(k), v));
            return normalized;
        }
        if (metadata instanceof String raw && !trim(raw).isBlank()) {
            try {
                return objectMapper.readValue(raw, MAP_TYPE);
            } catch (Exception ignored) {
                return Map.of();
            }
        }
        return Map.of();
    }

    private boolean isKnownCallWebhookPayload(Map<String, Object> payload, Map<String, Object> metadata) {
        Long tenantId = TenantContext.currentTenantIdOrNull();
        if (tenantId == null) {
            return false;
        }

        String externalId = firstNonBlank(
            stringValue(payload.get("externalId")),
            stringValue(payload.get("external_id")),
            stringValue(payload.get("callId")),
            stringValue(payload.get("call_id")),
            stringValue(payload.get("sipCallId")),
            stringValue(payload.get("sip_call_id")),
            stringValue(payload.get("executionId")),
            stringValue(payload.get("execution_id")),
            findFirstTextByKeys(payload, List.of("execution_id", "executionId", "call_id", "callId"))
        );
        if (!externalId.isBlank() && communicationRecordRepository
            .findFirstByTenantIdAndChannelIgnoreCaseAndExternalIdOrderByCreatedAtDesc(tenantId, "CALL", externalId)
            .isPresent()) {
            return true;
        }

        String leadId = firstNonBlank(
            stringValue(payload.get("leadId")),
            stringValue(payload.get("lead_id")),
            stringValue(metadata.get("leadId")),
            stringValue(metadata.get("lead_id")),
            findFirstTextByKeys(payload, List.of("lead_id", "leadId"))
        );
        return !leadId.isBlank()
            && !communicationRecordRepository
                .findTop50ByTenantIdAndLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(tenantId, leadId, "CALL")
                .isEmpty();
    }

    private Object readSafeJsonObject(String rawPayload) {
        String raw = trim(rawPayload);
        if (raw.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(raw, Object.class);
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private String extractTranscript(Map<String, Object> payload, Map<String, Object> metadata) {
        String direct = firstNonBlank(
            stringValue(payload.get("transcript")),
            stringValue(payload.get("finalTranscript")),
            stringValue(payload.get("final_transcript")),
            stringValue(payload.get("fullTranscript")),
            stringValue(payload.get("full_transcript"))
        );
        if (!direct.isBlank()) {
            return direct;
        }

        if (metadata != null && !metadata.isEmpty()) {
            direct = firstNonBlank(
                stringValue(metadata.get("transcript")),
                stringValue(metadata.get("finalTranscript")),
                stringValue(metadata.get("final_transcript"))
            );
            if (!direct.isBlank()) {
                return direct;
            }
        }

        String nested = extractTranscriptFromNode(payload.get("transcripts"));
        if (!nested.isBlank()) {
            return nested;
        }

        nested = extractTranscriptFromNode(payload.get("conversation"));
        if (!nested.isBlank()) {
            return nested;
        }

        nested = extractTranscriptFromNode(payload.get("messages"));
        if (!nested.isBlank()) {
            return nested;
        }

        nested = extractTranscriptFromNode(payload.get("response"));
        if (!nested.isBlank()) {
            return nested;
        }

        nested = extractTranscriptFromNode(payload.get("data"));
        if (!nested.isBlank()) {
            return nested;
        }

        for (Object value : payload.values()) {
            if (value instanceof Map<?, ?> || value instanceof List<?>) {
                nested = extractTranscriptFromNode(value);
                if (!nested.isBlank()) {
                    return nested;
                }
            }
        }

        return "";
    }

    private String extractTranscriptFromRawPayload(String rawPayload) {
        String raw = trim(rawPayload);
        if (raw.isBlank()) {
            return "";
        }
        try {
            Object root = objectMapper.readValue(raw, Object.class);
            String transcript = extractTranscriptFromNode(root);
            if (!transcript.isBlank()) {
                return transcript;
            }
            if (root instanceof Map<?, ?> map) {
                Object response = map.get("response");
                transcript = extractTranscriptFromNode(response);
                if (!transcript.isBlank()) {
                    return transcript;
                }
                Object data = map.get("data");
                transcript = extractTranscriptFromNode(data);
                if (!transcript.isBlank()) {
                    return transcript;
                }
            }
            return "";
        } catch (Exception ignored) {
            return "";
        }
    }

    private String extractTranscriptFromNode(Object node) {
        if (node instanceof Map<?, ?> map) {
            String direct = firstNonBlank(
                stringValue(map.get("transcript")),
                stringValue(map.get("finalTranscript")),
                stringValue(map.get("final_transcript")),
                stringValue(map.get("fullTranscript")),
                stringValue(map.get("full_transcript")),
                stringValue(map.get("conversationTranscript")),
                stringValue(map.get("conversation_transcript"))
            );
            if (!direct.isBlank()) {
                return direct;
            }

            Object transcriptRows = map.get("transcripts");
            String merged = mergeTranscriptRows(transcriptRows);
            if (!merged.isBlank()) {
                return merged;
            }

            for (Object value : map.values()) {
                if (value instanceof Map<?, ?> || value instanceof List<?>) {
                    String nested = extractTranscriptFromNode(value);
                    if (!nested.isBlank()) {
                        return nested;
                    }
                }
            }
            return "";
        }

        if (node instanceof List<?> rows) {
            String merged = mergeTranscriptRows(rows);
            if (!merged.isBlank()) {
                return merged;
            }

            StringBuilder fallback = new StringBuilder();
            for (Object item : rows) {
                if (item instanceof Map<?, ?> || item instanceof List<?>) {
                    String nested = extractTranscriptFromNode(item);
                    if (!nested.isBlank()) {
                        if (!fallback.isEmpty()) {
                            fallback.append("\n");
                        }
                        fallback.append(nested);
                    }
                } else {
                    String text = trim(stringValue(item));
                    if (!text.isBlank()) {
                        if (!fallback.isEmpty()) {
                            fallback.append("\n");
                        }
                        fallback.append(text);
                    }
                }
            }
            return fallback.toString();
        }

        if (node instanceof String text) {
            String trimmed = trim(text);
            if (trimmed.isBlank()) {
                return "";
            }
            String lower = trimmed.toLowerCase(Locale.ROOT);
            if (lower.contains("[agent]") || lower.contains("[user]") || lower.contains("agent:") || lower.contains("user:")) {
                return trimmed;
            }
        }

        return "";
    }

    private String mergeTranscriptRows(Object rows) {
        if (!(rows instanceof List<?> list)) {
            return "";
        }
        StringBuilder merged = new StringBuilder();
        for (Object row : list) {
            if (!(row instanceof Map<?, ?> map)) {
                continue;
            }
            String speaker = trim(stringValue(map.get("speaker")));
            String text = firstNonBlank(
                stringValue(map.get("text")),
                stringValue(map.get("transcript")),
                stringValue(map.get("message")),
                stringValue(map.get("content")),
                stringValue(map.get("utterance")),
                stringValue(map.get("reply"))
            );
            if (text.isBlank()) {
                String nested = extractTranscriptFromNode(map.get("messages"));
                if (nested.isBlank()) {
                    nested = extractTranscriptFromNode(map.get("transcript"));
                }
                text = nested;
            }
            if (text.isBlank()) {
                continue;
            }
            if (!merged.isEmpty()) {
                merged.append("\n");
            }
            if (!speaker.isBlank()) {
                merged.append("[").append(speaker).append("] ");
            }
            merged.append(text);
        }
        return merged.toString();
    }

    private String findFirstTextByKeys(Object node, List<String> keys) {
        if (node instanceof Map<?, ?> map) {
            for (String key : keys) {
                Object value = map.get(key);
                String text = trim(stringValue(value));
                if (!text.isBlank()) {
                    return text;
                }
            }
            for (Object value : map.values()) {
                if (value instanceof Map<?, ?> || value instanceof List<?>) {
                    String nested = findFirstTextByKeys(value, keys);
                    if (!nested.isBlank()) {
                        return nested;
                    }
                }
            }
        } else if (node instanceof List<?> list) {
            for (Object item : list) {
                String nested = findFirstTextByKeys(item, keys);
                if (!nested.isBlank()) {
                    return nested;
                }
            }
        }
        return "";
    }

    private String toJson(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (Exception ignored) {
            return "";
        }
    }

    private Lead.ExpectedCloseTimeline resolveTimelineFromPayload(Map<String, Object> payload, Map<String, Object> metadata, String outcome) {
        String timelineRaw = firstNonBlank(
            stringValue(payload.get("timeline")),
            stringValue(payload.get("expected_timeline")),
            stringValue(payload.get("expectedCloseTimeline")),
            stringValue(metadata.get("timeline")),
            stringValue(metadata.get("expected_timeline")),
            stringValue(metadata.get("expectedCloseTimeline"))
        ).toUpperCase(Locale.ROOT).replace("-", "_").replace(" ", "_");

        if (timelineRaw.contains("1_3") || timelineRaw.contains("1_TO_3") || timelineRaw.contains("DAYS_1_3")) {
            return Lead.ExpectedCloseTimeline.DAYS_1_3;
        }
        if (timelineRaw.contains("7_10") || timelineRaw.contains("7_TO_10") || timelineRaw.contains("DAYS_7_10")) {
            return Lead.ExpectedCloseTimeline.DAYS_7_10;
        }
        if (timelineRaw.contains("10_15") || timelineRaw.contains("15") || timelineRaw.contains("LATER")
            || timelineRaw.contains("DAYS_10_15") || timelineRaw.contains("MONTH")) {
            return Lead.ExpectedCloseTimeline.DAYS_10_15_PLUS;
        }

        String callOutcome = firstNonBlank(
            stringValue(payload.get("call_outcome")),
            stringValue(metadata.get("call_outcome")),
            outcome
        ).toUpperCase(Locale.ROOT);

        if (callOutcome.contains("HOT")) return Lead.ExpectedCloseTimeline.DAYS_1_3;
        if (callOutcome.contains("WARM")) return Lead.ExpectedCloseTimeline.DAYS_7_10;
        if (callOutcome.contains("COLD")) return Lead.ExpectedCloseTimeline.DAYS_10_15_PLUS;

        return null;
    }

    private String resolveHotSignal(Map<String, Object> payload, Map<String, Object> metadata, String outcome) {
        String textualSignal = firstNonBlank(
            stringValue(payload.get("scoreLabel")),
            stringValue(payload.get("leadScore")),
            stringValue(payload.get("lead_score")),
            stringValue(metadata.get("scoreLabel")),
            stringValue(metadata.get("leadScore")),
            outcome
        ).toUpperCase(Locale.ROOT);

        if (textualSignal.contains("HOT")) return "HOT";
        if (textualSignal.contains("WARM")) return "WARM";

        Integer numericScore = parseInteger(
            firstNonBlank(
                stringValue(payload.get("scoreValue")),
                stringValue(payload.get("leadScoreValue")),
                stringValue(payload.get("lead_score_value")),
                stringValue(metadata.get("scoreValue")),
                stringValue(metadata.get("leadScoreValue")),
                stringValue(payload.get("score"))
            )
        );
        if (numericScore == null) return "";
        if (numericScore >= 75) return "HOT";
        if (numericScore >= 45) return "WARM";
        return "COLD";
    }

    private boolean assignIfUnassigned(Lead lead) {
        if (lead.getAssignedTo() != null) {
            return false;
        }
        String rawFlag = trim(integrationService.getConfig("voice_call_agent").get("autoAssignHotLead"));
        if (!rawFlag.isBlank() && !parseBooleanFlag(rawFlag)) {
            return false;
        }

        Optional<User> assignee = userRepository.findByTenantIdAndDeletedFalse(tenantId()).stream()
            .filter(user -> Boolean.TRUE.equals(user.getIsActive()))
            .min(Comparator
                .comparingInt((User user) -> roleRank(user.getRole()))
                .thenComparing(user -> user.getCreatedAt() == null ? LocalDateTime.MAX : user.getCreatedAt()));

        if (assignee.isEmpty()) {
            return false;
        }

        User user = assignee.get();
        lead.setAssignedTo(user);
        notificationPublisher.notifyLeadAssigned(user.getEmail(), trim(lead.getName()));
        return true;
    }

    private int roleRank(User.Role role) {
        if (role == null) return 4;
        if (User.isSalesLike(role)) return 1;
        if (role == User.Role.MANAGER) return 2;
        if (User.isAdminLike(role)) return 3;
        return 4;
    }

    private void saveLeadCallActivity(
        Lead lead,
        String status,
        String outcome,
        String externalId,
        String summary,
        String transcript,
        Map<String, Object> payload
    ) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel", "voice_call_agent");
        values.put("status", status);
        values.put("callOutcome", outcome);
        values.put("externalId", externalId);
        values.put("note", summary);
        values.put("transcript", transcript);
        values.put("phone", trim(lead.getPhone()));
        values.put("payload", payload);

        String cleanSummary = firstNonBlank(
            !outcome.isBlank() ? "Call outcome: " + outcome : "",
            !status.isBlank() ? "Call status: " + status : "",
            summary
        );
        if (cleanSummary.isBlank()) {
            cleanSummary = "AI call webhook update received";
        }

        LeadActivity activity = LeadActivity.builder()
            .leadId(lead.getId())
            .activityIndex(0)
            .activityId("act01")
            .activityLabel("Activity 01")
            .activityTitle("Call Outcome")
            .assignedTo(lead.getAssignedTo() != null ? trim(lead.getAssignedTo().getName()) : "AI Calling Agent")
            .summary(cleanSummary)
            .values(values)
            .savedAt(LocalDateTime.now())
            .build();
        activity.setTenantId(tenantId());
        leadActivityRepository.save(activity);
    }

    private void applyCallIntelligenceToLead(Lead lead, Map<String, Object> currentCallRow) {
        if (lead == null) {
            return;
        }
        if (lead.getStatus() == Lead.LeadStatus.WON) {
            return;
        }

        List<CommunicationRecord> calls = communicationRecordRepository
            .findTop50ByLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(lead.getId(), "CALL");
        List<Map<String, Object>> history = calls.stream()
            .map(this::toCallHistoryRow)
            .toList();

        List<Map<String, Object>> analysisWindow = buildAiAnalysisWindow(history, currentCallRow);
        if (analysisWindow.isEmpty()) {
            return;
        }

        Map<String, Object> analysis;
        try {
            analysis = aiService.analyzeCallIntelligence(lead, analysisWindow);
        } catch (Exception ex) {
            log.warn("Call intelligence review failed for lead {}: {}", lead.getId(), ex.getMessage());
            return;
        }

        Lead.LeadStatus beforeStatus = lead.getStatus() != null ? lead.getStatus() : Lead.LeadStatus.NEW;
        Lead.LeadStatus resolvedStatus = resolveLeadStatusFromAnalysis(lead, analysis, analysisWindow);
        Integer confidence = safeConfidence(analysis);
        String nextBestAction = trim(stringValue(analysis.get("nextBestAction")));

        lead.setAiScoreValue(confidence);
        if (!nextBestAction.isBlank()) {
            lead.setAiNextAction(nextBestAction);
        }
        if (resolvedStatus != beforeStatus) {
            lead.setStatus(resolvedStatus);
        }
        leadChangeAuditService.save(lead);
        syncPipelineDealForLead(lead, resolvedStatus, currentCallRow);

        if (resolvedStatus != beforeStatus) {
            saveAiLeadReviewActivity(lead, beforeStatus, resolvedStatus, analysis, currentCallRow);
        }

        // ponytail: lead-facing WA disabled by request; re-enable by uncommenting
        // sendPostCallIntelligenceWhatsApp(lead, analysis, resolvedStatus);
        sendAdminCallIntelligenceWhatsApp(lead, analysis, resolvedStatus, currentCallRow);
    }

    private void saveAiLeadReviewActivity(
        Lead lead,
        Lead.LeadStatus previousStatus,
        Lead.LeadStatus newStatus,
        Map<String, Object> analysis,
        Map<String, Object> currentCallRow
    ) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel", "voice_call_agent");
        values.put("reviewType", "ai_call_intelligence");
        values.put("leadVerdict", analysis.getOrDefault("leadVerdict", "UNCERTAIN"));
        values.put("suggestedLeadStatus", analysis.getOrDefault("suggestedLeadStatus", newStatus.name()));
        values.put("confidence", safeConfidence(analysis));
        values.put("summary", analysis.getOrDefault("summary", ""));
        values.put("reasoning", analysis.getOrDefault("reasoning", ""));
        values.put("positiveSignals", analysis.getOrDefault("positiveSignals", List.of()));
        values.put("riskSignals", analysis.getOrDefault("riskSignals", List.of()));
        values.put("nextBestAction", analysis.getOrDefault("nextBestAction", ""));
        values.put("previousStatus", previousStatus.name());
        values.put("newStatus", newStatus.name());
        values.put("currentCall", currentCallRow);

        String summary = "AI call review: " + analysis.getOrDefault("leadVerdict", "UNCERTAIN")
            + " (" + safeConfidence(analysis) + "%) · " + previousStatus.name() + " → " + newStatus.name();

        LeadActivity activity = LeadActivity.builder()
            .leadId(lead.getId())
            .activityIndex(0)
            .activityId("ai01")
            .activityLabel("AI Review")
            .activityTitle("AI Call Intelligence")
            .assignedTo(lead.getAssignedTo() != null ? trim(lead.getAssignedTo().getName()) : "AI Calling Agent")
            .summary(summary)
            .values(values)
            .savedAt(LocalDateTime.now())
            .build();
        activity.setTenantId(tenantId());
        leadActivityRepository.save(activity);
    }

    private void sendPostCallIntelligenceWhatsApp(Lead lead, Map<String, Object> analysis, Lead.LeadStatus resolvedStatus) {
        String phone = trim(lead.getPhone());
        if (phone.isBlank()) {
            // Fallback: resolve phone from call automation workflow or communication records
            phone = resolveLeadPhoneFallback(lead.getId());
        }
        if (phone.isBlank()) return;

        String verdict = trim(stringValue(analysis.get("leadVerdict"))).toUpperCase(Locale.ROOT);
        if ("NOT_GENUINE".equals(verdict)) return;

        String name = trim(lead.getName());
        String company = trim(lead.getCompany());
        String service = trim(lead.getService());
        String dealValue = lead.getDealValue() != null ? lead.getDealValue().toPlainString() : "";
        String aiSummary = trim(stringValue(analysis.get("summary")));
        String nextAction = trim(stringValue(analysis.get("nextBestAction")));

        String assignedTo = lead.getAssignedTo() != null ? trim(lead.getAssignedTo().getName()) : "";
        int confidence = safeConfidence(analysis);

        StringBuilder msg = new StringBuilder();
        msg.append("Hi");
        if (!name.isBlank()) msg.append(" ").append(name);
        msg.append("! 👋\n\n");
        msg.append("Thank you for taking the time to speak with us. We truly appreciate it.\n\n");
        msg.append("📋 *Your Enquiry Details:*\n");
        if (!name.isBlank()) msg.append("• *Name:* ").append(name).append("\n");
        if (!company.isBlank()) msg.append("• *Company:* ").append(company).append("\n");
        if (!service.isBlank()) msg.append("• *Requirement:* ").append(service).append("\n");
        if (!dealValue.isBlank()) msg.append("• *Budget:* ₹").append(dealValue).append("\n");
        msg.append("\n");

        if (!aiSummary.isBlank()) {
            msg.append("📝 *Conversation Summary:*\n");
            String shortSummary = aiSummary.length() > 250 ? aiSummary.substring(0, 250) + "..." : aiSummary;
            msg.append(shortSummary).append("\n\n");
        }

        if (!nextAction.isBlank()) {
            msg.append("🎯 *Next Step:* ").append(nextAction).append("\n\n");
        }

        if (!assignedTo.isBlank()) {
            msg.append("Your dedicated contact person is *").append(assignedTo).append("*, who will be reaching out to you shortly.\n\n");
        } else {
            msg.append("A member of our team will reach out to you shortly with next steps.\n\n");
        }

        msg.append("Feel free to reply here anytime with questions or additional details. We're here to help! 🙏");

        try {
            communicationService.sendChannelMessage("whatsapp", phone, "", msg.toString());
            log.info("Post-call intelligence WhatsApp sent to lead {}", lead.getId());
        } catch (Exception ex) {
            log.warn("Post-call intelligence WhatsApp failed for lead {}: {}", lead.getId(), ex.getMessage());
        }
    }

    private void sendAdminCallIntelligenceWhatsApp(
        Lead lead,
        Map<String, Object> analysis,
        Lead.LeadStatus resolvedStatus,
        Map<String, Object> currentCallRow
    ) {
        java.util.List<String> adminPhones = resolveAdminNotificationPhones();
        if (adminPhones.isEmpty()) return;

        String verdict = trim(stringValue(analysis.get("leadVerdict")));
        int confidence = safeConfidence(analysis);
        String aiSummary = trim(stringValue(analysis.get("summary")));
        String reasoning = trim(stringValue(analysis.get("reasoning")));
        String nextAction = trim(stringValue(analysis.get("nextBestAction")));
        List<String> positiveSignals = readStringList(analysis.get("positiveSignals"));
        List<String> riskSignals = readStringList(analysis.get("riskSignals"));

        String callStatus = currentCallRow != null ? trim(stringValue(currentCallRow.get("status"))) : "";
        String callOutcome = currentCallRow != null ? trim(stringValue(currentCallRow.get("outcome"))) : "";
        String transcript = currentCallRow != null ? trim(stringValue(currentCallRow.get("transcript"))) : "";
        String recordingUrl = currentCallRow != null ? trim(stringValue(currentCallRow.get("recordingUrl"))) : "";

        String name = trim(lead.getName());
        String phone = trim(lead.getPhone());
        String company = trim(lead.getCompany());
        String service = trim(lead.getService());
        String email = trim(lead.getEmail());
        String dealValue = lead.getDealValue() != null ? "₹" + lead.getDealValue().toPlainString() : "";
        String score = lead.getScore() != null ? lead.getScore().name() : "";
        String source = lead.getSource() != null ? lead.getSource().name() : "";
        String assignedTo = lead.getAssignedTo() != null ? trim(lead.getAssignedTo().getName()) : "Unassigned";
        String now = LocalDateTime.now(java.time.ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a"));

        StringBuilder msg = new StringBuilder();
        msg.append("📞 *CALL INTELLIGENCE REPORT*\n");
        msg.append("━━━━━━━━━━━━━━━━━━━━━━\n");
        msg.append("📅 ").append(now).append("\n\n");

        msg.append("👤 *Lead Details:*\n");
        if (!name.isBlank()) msg.append("• Name: *").append(name).append("*\n");
        if (!phone.isBlank()) msg.append("• Phone: ").append(phone).append("\n");
        if (!email.isBlank()) msg.append("• Email: ").append(email).append("\n");
        if (!company.isBlank()) msg.append("• Company: ").append(company).append("\n");
        if (!service.isBlank()) msg.append("• Requirement: ").append(service).append("\n");
        if (!dealValue.isBlank()) msg.append("• Budget: ").append(dealValue).append("\n");
        if (!source.isBlank()) msg.append("• Source: ").append(source).append("\n");
        msg.append("\n");

        msg.append("📊 *Call Status:*\n");
        if (!callStatus.isBlank()) msg.append("• Status: ").append(callStatus).append("\n");
        if (!callOutcome.isBlank()) msg.append("• Outcome: ").append(callOutcome).append("\n");
        msg.append("• Lead Score: ").append(score.isBlank() ? "—" : score).append("\n");
        msg.append("• Lead Stage: ").append(resolvedStatus != null ? resolvedStatus.name() : "—").append("\n");
        msg.append("• Assigned To: ").append(assignedTo).append("\n");
        msg.append("\n");

        msg.append("🤖 *AI Verdict:* ").append(verdict.isBlank() ? "UNCERTAIN" : verdict.toUpperCase(Locale.ROOT));
        msg.append(" (").append(confidence).append("% confidence)\n\n");

        if (!aiSummary.isBlank()) {
            msg.append("📝 *Call Summary:*\n");
            String shortSummary = aiSummary.length() > 500 ? aiSummary.substring(0, 500) + "..." : aiSummary;
            msg.append(shortSummary).append("\n\n");
        }

        if (!reasoning.isBlank()) {
            msg.append("💡 *AI Reasoning:*\n");
            String shortReasoning = reasoning.length() > 300 ? reasoning.substring(0, 300) + "..." : reasoning;
            msg.append(shortReasoning).append("\n\n");
        }

        if (!positiveSignals.isEmpty()) {
            msg.append("✅ *Positive Signals:*\n");
            for (String signal : positiveSignals) {
                msg.append("  • ").append(signal).append("\n");
            }
            msg.append("\n");
        }

        if (!riskSignals.isEmpty()) {
            msg.append("⚠️ *Risk Signals:*\n");
            for (String signal : riskSignals) {
                msg.append("  • ").append(signal).append("\n");
            }
            msg.append("\n");
        }

        if (!nextAction.isBlank()) {
            msg.append("🎯 *Next Best Action:*\n").append(nextAction).append("\n\n");
        }

        if (!transcript.isBlank()) {
            msg.append("🗣️ *Call Transcript:*\n");
            String shortTranscript = transcript.length() > 1500 ? transcript.substring(0, 1500) + "...\n_(truncated)_" : transcript;
            msg.append(shortTranscript).append("\n\n");
        }

        if (!recordingUrl.isBlank()) {
            msg.append("🔊 *Recording:* ").append(recordingUrl).append("\n\n");
        }

        msg.append("━━━━━━━━━━━━━━━━━━━━━━\n");
        msg.append("_NexaCRM Call Intelligence_");

        String message = msg.toString();
        for (String adminPhone : adminPhones) {
            try {
                communicationService.sendChannelMessage("whatsapp", adminPhone, "", message);
                log.info("Admin call intelligence WhatsApp sent for lead {} to {}", lead.getId(), adminPhone);
            } catch (Exception ex) {
                log.warn("Admin call intelligence WhatsApp failed for lead {} to {}: {}", lead.getId(), adminPhone, ex.getMessage());
            }
        }
    }

    private String resolveLeadPhoneFallback(String leadId) {
        // Try call automation workflow's contact number
        try {
            Optional<com.nexacrm.model.LeadCallAutomation> workflow = leadCallAutomationService.findForLead(leadId);
            if (workflow.isPresent()) {
                String contact = trim(workflow.get().getContactNumber());
                if (!contact.isBlank()) return contact;
            }
        } catch (Exception ignored) {}
        // Try most recent outbound CALL communication record
        try {
            List<CommunicationRecord> calls = communicationRecordRepository
                .findTop50ByLeadIdAndChannelIgnoreCaseOrderByCreatedAtDesc(leadId, "CALL");
            for (CommunicationRecord call : calls) {
                String contact = trim(call.getContactIdentifier());
                if (!contact.isBlank()) return contact;
            }
        } catch (Exception ignored) {}
        return "";
    }

    private java.util.List<String> resolveAdminNotificationPhones() {
        String configPhone = trim(integrationService.getConfig("voice_call_agent").get("adminNotificationPhone"));
        java.util.List<String> phones = new java.util.ArrayList<>();
        if (!configPhone.isBlank()) {
            for (String p : configPhone.split("[,;\\s]+")) {
                String cleaned = trim(p);
                if (!cleaned.isBlank()) phones.add(cleaned);
            }
        }
        if (phones.isEmpty()) {
            Long currentTenantId = TenantContext.currentTenantIdOrNull();
            if (currentTenantId != null) {
                tenantRepository.findByTenantIdAndDeletedFalse(currentTenantId)
                    .map(t -> trim(t.getContactPhone()))
                    .filter(p -> !p.isBlank())
                    .ifPresent(phones::add);
            }
        }
        return phones;
    }

    private Lead.LeadStatus resolveLeadStatusFromAnalysis(
        Lead lead,
        Map<String, Object> analysis,
        List<Map<String, Object>> history
    ) {
        Lead.LeadStatus current = lead.getStatus() != null ? lead.getStatus() : Lead.LeadStatus.NEW;
        String verdict = firstNonBlank(stringValue(analysis.get("leadVerdict"))).toUpperCase(Locale.ROOT);
        int confidence = safeConfidence(analysis);
        boolean hasConversationEvidence = history != null && history.stream().anyMatch(this::hasMeaningfulCallEvidence);
        List<String> positiveSignals = readStringList(analysis.get("positiveSignals"));

        if ("GENUINE".equals(verdict) && confidence >= 70 && hasConversationEvidence) {
            if (current == Lead.LeadStatus.WON) {
                return current;
            }
            if (current == Lead.LeadStatus.NEGOTIATION) {
                return current;
            }
            if (current == Lead.LeadStatus.QUALIFIED || current == Lead.LeadStatus.PROPOSAL) {
                return Lead.LeadStatus.NEGOTIATION;
            }
            return Lead.LeadStatus.QUALIFIED;
        }

        if ("NOT_GENUINE".equals(verdict) && confidence >= 90 && positiveSignals.isEmpty()) {
            if (current != Lead.LeadStatus.WON) {
                return Lead.LeadStatus.LOST;
            }
        }

        return current;
    }

    private void syncPipelineDealForLead(Lead lead, Lead.LeadStatus resolvedStatus, Map<String, Object> currentCallRow) {
        if (lead == null || resolvedStatus == null) {
            return;
        }
        if (!isPipelineEligible(resolvedStatus)) {
            return;
        }

        Deal deal = dealRepository.findByLead_IdAndTenantIdAndDeletedFalse(lead.getId(), tenantId())
            .orElse(null);
        boolean created = false;
        if (deal == null) {
            deal = createDealFromLead(lead, resolvedStatus, currentCallRow);
            created = true;
        }
        boolean dirty = false;
        Deal.DealStage targetStage = mapLeadStatusToDealStage(resolvedStatus);
        if (targetStage != null && deal.getStage() != targetStage) {
            deal.setStage(targetStage);
            dirty = true;
        }
        if (lead.getDealValue() != null && (deal.getDealValue() == null || deal.getDealValue().compareTo(lead.getDealValue()) != 0)) {
            deal.setDealValue(lead.getDealValue());
            dirty = true;
        }
        if (lead.getAssignedTo() != null && deal.getOwner() == null) {
            deal.setOwner(lead.getAssignedTo());
            dirty = true;
        }
        if ((deal.getNotes() == null || deal.getNotes().isBlank()) && lead.getNotes() != null && !lead.getNotes().isBlank()) {
            deal.setNotes(lead.getNotes());
            dirty = true;
        }
        if (lead.getCompany() != null && !lead.getCompany().isBlank()) {
            String expectedTitle = lead.getCompany().trim() + " Opportunity";
            if (deal.getTitle() == null || deal.getTitle().isBlank() || deal.getTitle().toLowerCase(Locale.ROOT).contains("opportunity")) {
                if (!expectedTitle.equals(deal.getTitle())) {
                    deal.setTitle(expectedTitle);
                    dirty = true;
                }
            }
        }
        if (dirty) {
            dealRepository.save(deal);
        }
        if (created || dirty) {
            try {
                notificationPublisher.broadcast(Map.of(
                    "type", "DEAL",
                    "title", "Pipeline Updated",
                    "message", (lead.getName() != null ? lead.getName() : "Lead") + " moved to " + targetStage.name(),
                    "actionUrl", "/pipeline",
                    "timestamp", System.currentTimeMillis()
                ));
            } catch (Exception ex) {
                log.warn("Failed to broadcast pipeline refresh for lead {}: {}", lead.getId(), ex.getMessage());
            }
        }
    }

    private Deal createDealFromLead(Lead lead, Lead.LeadStatus resolvedStatus, Map<String, Object> currentCallRow) {
        String title = (lead.getCompany() != null && !lead.getCompany().isBlank())
            ? lead.getCompany().trim() + " Opportunity"
            : (lead.getName() != null && !lead.getName().isBlank() ? lead.getName().trim() + " Opportunity" : "New Opportunity");

        Deal.DealBuilder builder = Deal.builder()
            .title(title)
            .description(buildDealDescription(lead, currentCallRow))
            .stage(mapLeadStatusToDealStage(resolvedStatus))
            .priority(mapLeadPriorityToDealPriority(lead.getPriority()))
            .dealValue(lead.getDealValue())
            .pipelineId(1L)
            .lead(lead)
            .notes(lead.getNotes());

        if (lead.getAssignedTo() != null) {
            builder.owner(lead.getAssignedTo());
        }

        Deal deal = builder.build();
        deal.setTenantId(tenantId());
        return dealRepository.save(deal);
    }

    private String buildDealDescription(Lead lead, Map<String, Object> currentCallRow) {
        StringBuilder description = new StringBuilder("Auto-created from lead intelligence");
        if (lead.getService() != null && !lead.getService().isBlank()) {
            description.append("\nService: ").append(lead.getService().trim());
        }
        if (lead.getCompany() != null && !lead.getCompany().isBlank()) {
            description.append("\nCompany: ").append(lead.getCompany().trim());
        }
        if (currentCallRow != null) {
            String summary = trim(stringValue(currentCallRow.get("summary")));
            if (!summary.isBlank()) {
                description.append("\nLatest call: ").append(summary);
            }
        }
        return description.toString();
    }

    private Deal.DealStage mapLeadStatusToDealStage(Lead.LeadStatus status) {
        if (status == null) {
            return Deal.DealStage.NEW;
        }
        return switch (status) {
            case NEW -> Deal.DealStage.NEW;
            case CONTACTED -> Deal.DealStage.CONTACTED;
            case QUALIFIED -> Deal.DealStage.QUALIFIED;
            case PROPOSAL -> Deal.DealStage.PROPOSAL;
            case NEGOTIATION -> Deal.DealStage.NEGOTIATION;
            case WON -> Deal.DealStage.WON;
            case LOST -> Deal.DealStage.LOST;
        };
    }

    private Deal.DealPriority mapLeadPriorityToDealPriority(Lead.LeadPriority priority) {
        if (priority == null) {
            return Deal.DealPriority.MEDIUM;
        }
        return switch (priority) {
            case HIGH -> Deal.DealPriority.HIGH;
            case MEDIUM -> Deal.DealPriority.MEDIUM;
            case LOW -> Deal.DealPriority.LOW;
        };
    }

    private boolean isPipelineEligible(Lead.LeadStatus status) {
        return status == Lead.LeadStatus.QUALIFIED
            || status == Lead.LeadStatus.PROPOSAL
            || status == Lead.LeadStatus.NEGOTIATION
            || status == Lead.LeadStatus.WON
            || status == Lead.LeadStatus.LOST;
    }

    private List<String> readStringList(Object value) {
        if (value instanceof List<?> list) {
            List<String> converted = new ArrayList<>();
            for (Object item : list) {
                String text = trim(stringValue(item));
                if (!text.isBlank()) {
                    converted.add(text);
                }
            }
            return converted;
        }
        if (value instanceof String text) {
            List<String> converted = new ArrayList<>();
            for (String part : text.split("[\\n,;]+")) {
                String item = trim(part);
                if (!item.isBlank()) {
                    converted.add(item);
                }
            }
            return converted;
        }
        return List.of();
    }

    private boolean hasMeaningfulCallEvidence(Map<String, Object> call) {
        if (call == null || call.isEmpty()) {
            return false;
        }
        String transcript = trim(stringValue(call.get("transcript")));
        String summary = trim(stringValue(call.get("summary")));
        String recordingUrl = trim(stringValue(call.get("recordingUrl")));
        String status = stringValue(call.get("status"));
        String outcome = stringValue(call.get("outcome"));

        return !transcript.isBlank()
            || !summary.isBlank()
            || !recordingUrl.isBlank()
            || isConnectedStatus(status)
            || isPositiveOutcome(outcome);
    }

    private boolean isPositiveOutcome(String outcome) {
        String normalized = trim(outcome).toLowerCase(Locale.ROOT);
        return normalized.contains("connected")
            || normalized.contains("answered")
            || normalized.contains("callback")
            || normalized.contains("meeting")
            || normalized.contains("booked")
            || normalized.contains("interested")
            || normalized.contains("qualified")
            || normalized.contains("demo")
            || normalized.contains("scheduled")
            || normalized.contains("follow up")
            || normalized.contains("follow-up");
    }

    private int safeConfidence(Map<String, Object> analysis) {
        Object confidence = analysis == null ? null : analysis.get("confidence");
        if (confidence instanceof Number number) {
            return Math.max(0, Math.min(100, number.intValue()));
        }
        Integer parsed = parseInteger(stringValue(confidence));
        return parsed == null ? 0 : Math.max(0, Math.min(100, parsed));
    }

    private List<Map<String, Object>> buildAiAnalysisWindow(List<Map<String, Object>> history, Map<String, Object> currentCallRow) {
        List<Map<String, Object>> combined = new ArrayList<>();
        if (currentCallRow != null && !currentCallRow.isEmpty()) {
            combined.add(currentCallRow);
        }
        if (history != null && !history.isEmpty()) {
            combined.addAll(history);
        }
        if (combined.isEmpty()) {
            return List.of();
        }

        List<Map<String, Object>> strongEvidence = new ArrayList<>();
        List<Map<String, Object>> supportingEvidence = new ArrayList<>();
        List<Map<String, Object>> remaining = new ArrayList<>();
        LinkedHashSet<String> seenKeys = new LinkedHashSet<>();

        for (Map<String, Object> call : combined) {
            if (call == null || call.isEmpty()) {
                continue;
            }
            String key = firstNonBlank(
                stringValue(call.get("externalId")),
                stringValue(call.get("id")),
                stringValue(call.get("createdAt")) + "|" + stringValue(call.get("status")) + "|" + stringValue(call.get("outcome")) + "|" + stringValue(call.get("summary"))
            );
            if (key.isBlank()) {
                key = String.valueOf(call.hashCode());
            }
            if (!seenKeys.add(key)) {
                continue;
            }

            if (hasMeaningfulCallEvidence(call)) {
                strongEvidence.add(call);
            } else if (!trim(stringValue(call.get("summary"))).isBlank()) {
                supportingEvidence.add(call);
            } else {
                remaining.add(call);
            }
        }

        List<Map<String, Object>> window = new ArrayList<>(strongEvidence);
        window.addAll(supportingEvidence);
        window.addAll(remaining);
        if (window.size() > 8) {
            return new ArrayList<>(window.subList(0, 8));
        }
        return window;
    }

    private boolean isConnectedStatus(String status) {
        return CONNECTED_TERMINAL_STATUSES.contains(normalizeStatus(status));
    }

    private Integer extractDurationSeconds(Map<String, Object> payload, Map<String, Object> metadata) {
        Integer direct = firstInteger(
            payload.get("durationSeconds"),
            payload.get("duration_seconds"),
            payload.get("callDurationSeconds"),
            payload.get("call_duration_seconds"),
            payload.get("duration"),
            metadata.get("durationSeconds"),
            metadata.get("duration_seconds"),
            metadata.get("callDurationSeconds"),
            metadata.get("call_duration_seconds")
        );
        return direct == null || direct < 0 ? null : direct;
    }

    private Integer firstInteger(Object... values) {
        for (Object value : values) {
            if (value instanceof Number number) {
                return number.intValue();
            }
            Integer parsed = parseInteger(stringValue(value));
            if (parsed != null) {
                return parsed;
            }
        }
        return null;
    }

    private Long firstLong(Object... values) {
        for (Object value : values) {
            if (value instanceof Number number) {
                return number.longValue();
            }
            String raw = stringValue(value);
            if (raw == null || raw.isBlank()) {
                continue;
            }
            try {
                return Long.parseLong(raw.trim());
            } catch (NumberFormatException ignored) {
                // try next value
            }
        }
        return null;
    }

    private String normalizeStatus(String status) {
        String normalized = trim(status)
            .toUpperCase(Locale.ROOT)
            .replace(' ', '_')
            .replace('-', '_');
        return normalized.isBlank() ? "RECEIVED" : normalized;
    }

    private String normalizeOutcome(String outcome) {
        return trim(outcome).toLowerCase(Locale.ROOT);
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (!trim(value).isBlank()) {
                return trim(value);
            }
        }
        return "";
    }

    private boolean parseBooleanFlag(String raw) {
        String normalized = trim(raw).toLowerCase(Locale.ROOT);
        return "true".equals(normalized)
            || "1".equals(normalized)
            || "yes".equals(normalized)
            || "on".equals(normalized)
            || "enabled".equals(normalized);
    }

    private Integer parseInteger(String raw) {
        String value = trim(raw);
        if (value.isBlank()) return null;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private Map<String, Object> toCallHistoryRow(CommunicationRecord call) {
        String rawPayload = call.getRawPayload();
        String transcript = extractTranscriptFromRawPayload(rawPayload);
        String recordingUrl = extractRecordingUrl(rawPayload);
        String summary = extractSummary(rawPayload, call.getBody(), transcript);
        Map<String, Object> bolnaExecution = Map.of();
        if (transcript.isBlank() || recordingUrl.isBlank() || summary.isBlank()) {
            bolnaExecution = fetchBolnaExecutionDetails(resolveExecutionId(call, rawPayload));
            if (!bolnaExecution.isEmpty()) {
                if (transcript.isBlank()) {
                    transcript = firstNonBlank(
                        extractTranscriptFromNode(bolnaExecution),
                        transcript
                    );
                }
                if (recordingUrl.isBlank()) {
                    recordingUrl = firstNonBlank(
                        findFirstTextByKeys(bolnaExecution, List.of("recording_url", "recordingUrl", "recording")),
                        recordingUrl
                    );
                }
                if (summary.isBlank()) {
                    summary = firstNonBlank(
                        findFirstTextByKeys(bolnaExecution, List.of("summary", "note", "message", "description")),
                        summary
                    );
                }
            }
        }
        if (summary.isBlank() && !transcript.isBlank()) {
            summary = transcript.length() > 320 ? transcript.substring(0, 320) + "..." : transcript;
        }
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", call.getId());
        row.put("leadId", call.getLeadId());
        row.put("status", call.getStatus());
        row.put("outcome", extractOutcome(rawPayload));
        row.put("externalId", call.getExternalId());
        row.put("phone", call.getContactIdentifier());
        row.put("script", call.getBody());
        row.put("provider", call.getProvider());
        row.put("createdAt", call.getCreatedAt());
        row.put("rawPayload", rawPayload);
        row.put("transcript", transcript);
        row.put("recordingUrl", recordingUrl);
        row.put("summary", summary);
        row.put("durationSeconds", extractDurationSeconds(rawPayload));
        return row;
    }

    private int resolveAttemptNumber(Map<String, Object> row, int fallback) {
        Object rawPayload = row.get("rawPayload");
        if (rawPayload instanceof String raw && !raw.isBlank()) {
            try {
                Object root = objectMapper.readValue(raw, Object.class);
                Integer parsed = firstInteger(
                    findFirstTextByKeys(root, List.of("attemptNumber", "attempt_number", "callAttempt", "call_attempt"))
                );
                if (parsed != null && parsed > 0) {
                    return parsed;
                }
            } catch (Exception ignored) {
                // fall back to sequence below
            }
        }
        return fallback;
    }

    private Integer extractDurationSeconds(String rawPayload) {
        String raw = trim(rawPayload);
        if (raw.isBlank()) return null;
        try {
            Object root = objectMapper.readValue(raw, Object.class);
            Integer parsed = firstInteger(findFirstTextByKeys(root, List.of(
                "durationSeconds",
                "duration_seconds",
                "callDurationSeconds",
                "call_duration_seconds",
                "duration"
            )));
            return parsed == null || parsed < 0 ? null : parsed;
        } catch (Exception ignored) {
            return null;
        }
    }

    private Map<String, Object> buildWebhookAnalysisCallRow(
        Lead lead,
        String externalId,
        String status,
        String outcome,
        String summary,
        String transcript,
        Map<String, Object> payload
    ) {
        Map<String, Object> source = new LinkedHashMap<>();
        if (payload != null && !payload.isEmpty()) {
            source.putAll(payload);
        }
        source.put("externalId", firstNonBlank(externalId, stringValue(source.get("externalId")), stringValue(source.get("executionId")), stringValue(source.get("execution_id"))));
        source.put("status", status);
        source.put("outcome", outcome);
        source.put("summary", summary);
        source.put("transcript", transcript);

        String sourceTranscript = extractTranscriptFromNode(source);
        String sourceRecordingUrl = findFirstTextByKeys(source, List.of("recording_url", "recordingUrl", "recording"));
        String sourceSummary = findFirstTextByKeys(source, List.of("summary", "note", "message", "description"));
        String resolvedExecutionId = resolveExecutionIdFromSource(source);
        Map<String, Object> bolnaExecution = Map.of();
        if (resolvedExecutionId.isBlank() || sourceTranscript.isBlank() || sourceRecordingUrl.isBlank() || sourceSummary.isBlank()) {
            bolnaExecution = fetchBolnaExecutionDetails(resolvedExecutionId);
        }

        String resolvedTranscript = firstNonBlank(
            transcript,
            sourceTranscript,
            extractTranscriptFromNode(bolnaExecution)
        );
        String resolvedRecordingUrl = firstNonBlank(
            sourceRecordingUrl,
            findFirstTextByKeys(bolnaExecution, List.of("recording_url", "recordingUrl", "recording"))
        );
        String resolvedSummary = firstNonBlank(
            summary,
            sourceSummary,
            findFirstTextByKeys(bolnaExecution, List.of("summary", "note", "message", "description"))
        );
        if (resolvedSummary.isBlank() && !resolvedTranscript.isBlank()) {
            resolvedSummary = resolvedTranscript.length() > 320 ? resolvedTranscript.substring(0, 320) + "..." : resolvedTranscript;
        }

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", firstNonBlank(resolvedExecutionId, "webhook:" + lead.getId() + ":" + LocalDateTime.now()));
        row.put("leadId", lead.getId());
        row.put("status", status);
        row.put("outcome", outcome);
        row.put("externalId", resolvedExecutionId);
        row.put("phone", trim(lead.getPhone()));
        row.put("script", "");
        row.put("provider", "voice_call_agent");
        row.put("createdAt", LocalDateTime.now());
        row.put("rawPayload", payload);
        row.put("transcript", resolvedTranscript);
        row.put("recordingUrl", resolvedRecordingUrl);
        row.put("summary", resolvedSummary);
        row.put("bolnaExecution", bolnaExecution);
        return row;
    }

    private String resolveExecutionId(CommunicationRecord call, String rawPayload) {
        String fromCall = trim(call.getExternalId());
        if (!fromCall.isBlank()) {
            return fromCall;
        }
        String fromPayload = resolveExecutionIdFromSource(readSafeJsonObject(rawPayload));
        if (!fromPayload.isBlank()) {
            return fromPayload;
        }
        return "";
    }

    private String resolveExecutionIdFromSource(Object source) {
        if (source instanceof Map<?, ?> map) {
            String direct = firstNonBlank(
                stringValue(map.get("externalId")),
                stringValue(map.get("executionId")),
                stringValue(map.get("execution_id")),
                stringValue(map.get("callId")),
                stringValue(map.get("call_id")),
                stringValue(map.get("id"))
            );
            if (!direct.isBlank()) {
                return direct;
            }
            for (Object value : map.values()) {
                if (value instanceof Map<?, ?> || value instanceof List<?>) {
                    String nested = resolveExecutionIdFromSource(value);
                    if (!nested.isBlank()) {
                        return nested;
                    }
                }
            }
        } else if (source instanceof List<?> list) {
            for (Object item : list) {
                String nested = resolveExecutionIdFromSource(item);
                if (!nested.isBlank()) {
                    return nested;
                }
            }
        }
        return "";
    }

    private Map<String, Object> fetchBolnaExecutionDetails(String executionId) {
        String normalizedExecutionId = trim(executionId);
        if (normalizedExecutionId.isBlank()) {
            return Map.of();
        }

        Map<String, String> config = integrationService.getConfig("voice_call_agent");
        String apiUrl = normalizeBolnaApiBaseUrl(firstNonBlank(
            config.get("bolnaApiUrl"),
            defaultBolnaApiUrl
        ));
        String apiKey = firstNonBlank(
            config.get("bolnaApiKey"),
            config.get("apiKey"),
            defaultBolnaApiKey
        );
        if (apiKey.isBlank()) {
            return Map.of();
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);
            headers.setAccept(List.of(MediaType.APPLICATION_JSON));

            ResponseEntity<String> response = restTemplate.exchange(
                apiUrl + "/executions/" + normalizedExecutionId,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class
            );
            String body = trim(response.getBody());
            if (body.isBlank()) {
                return Map.of();
            }
            Object root = objectMapper.readValue(body, Object.class);
            if (root instanceof Map<?, ?> map) {
                Map<String, Object> normalized = new LinkedHashMap<>();
                map.forEach((key, value) -> normalized.put(String.valueOf(key), value));
                return normalized;
            }
            return Map.of();
        } catch (HttpStatusCodeException ex) {
            log.debug("Failed to fetch Bolna execution {}: {}", normalizedExecutionId, ex.getStatusCode());
            return Map.of();
        } catch (Exception ex) {
            log.debug("Failed to fetch Bolna execution {}: {}", normalizedExecutionId, ex.getMessage());
            return Map.of();
        }
    }

    private String normalizeBolnaApiBaseUrl(String value) {
        String normalized = trim(value);
        if (normalized.isBlank()) {
            normalized = "https://api.bolna.ai";
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private String extractRecordingUrl(String rawPayload) {
        String raw = trim(rawPayload);
        if (raw.isBlank()) return "";
        try {
            Object root = objectMapper.readValue(raw, Object.class);
            String direct = findFirstTextByKeys(root, List.of("recording_url", "recordingUrl", "recording"));
            if (!direct.isBlank()) {
                return direct;
            }
            return "";
        } catch (Exception ignored) {
            return "";
        }
    }

    private String extractOutcome(String rawPayload) {
        String raw = trim(rawPayload);
        if (raw.isBlank()) return "";
        try {
            Object root = objectMapper.readValue(raw, Object.class);
            return findFirstTextByKeys(root, List.of("outcome", "callOutcome", "disposition", "result"));
        } catch (Exception ignored) {
            return "";
        }
    }

    private String extractSummary(String rawPayload, String fallbackBody, String transcript) {
        String raw = trim(rawPayload);
        if (!raw.isBlank()) {
            try {
                Object root = objectMapper.readValue(raw, Object.class);
                String summary = findFirstTextByKeys(root, List.of("summary", "note", "message", "description"));
                if (!summary.isBlank()) {
                    return summary;
                }
            } catch (Exception ignored) {
                // fall through
            }
        }

        String text = trim(transcript);
        if (!text.isBlank()) {
            return text.length() > 320 ? text.substring(0, 320) + "..." : text;
        }

        String body = trim(fallbackBody);
        if (!body.isBlank()) {
            return body;
        }
        return "";
    }
}
