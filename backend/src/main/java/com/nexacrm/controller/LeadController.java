package com.nexacrm.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexacrm.dto.LeadDTO;
import com.nexacrm.dto.LeadActivityDTO;
import com.nexacrm.dto.LeadPipelineBoardDTO;
import com.nexacrm.dto.PageResponse;
import com.nexacrm.model.Lead;
import com.nexacrm.service.LeadActivityService;
import com.nexacrm.service.LeadService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.core.io.Resource;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/leads")
@RequiredArgsConstructor
@Tag(name = "Leads", description = "Lead management endpoints")
public class LeadController {
    private static final int PIPELINE_BOARD_MAX_PAGE_SIZE = 50;

    private final LeadService leadService;
    private final LeadActivityService leadActivityService;
    private final ObjectMapper objectMapper;

    @Value("${meta.webhook-token:}")
    private String facebookIngestionToken;

    @GetMapping
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get all leads with pagination and filters")
    public ResponseEntity<PageResponse<LeadDTO>> getLeads(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String score,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String assignedTo,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(leadService.findAll(search, status, score, source, assignedTo, pageable));
    }

    @GetMapping("/pipeline-board")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get leads and activity previews for the pipeline board")
    public ResponseEntity<LeadPipelineBoardDTO> getPipelineBoard(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String score,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String assignedTo,
            @PageableDefault(size = 200) Pageable pageable) {
        return ResponseEntity.ok(leadService.findPipelineBoard(search, status, score, source, assignedTo, capPipelinePageable(pageable)));
    }

    private Pageable capPipelinePageable(Pageable pageable) {
        int page = pageable != null ? pageable.getPageNumber() : 0;
        int requestedSize = pageable != null ? pageable.getPageSize() : PIPELINE_BOARD_MAX_PAGE_SIZE;
        int size = Math.max(1, Math.min(requestedSize, PIPELINE_BOARD_MAX_PAGE_SIZE));
        Sort sort = pageable != null ? pageable.getSort() : Sort.unsorted();
        return PageRequest.of(page, size, sort);
    }

    @PostMapping("/activities/bulk")
    @PreAuthorize("hasAuthority('leads.read') or hasAuthority('tasks.read')")
    @Operation(summary = "Get lead activities for multiple leads")
    public ResponseEntity<Map<String, List<LeadActivityDTO>>> getLeadActivitiesBulk(
            @RequestBody Map<String, List<String>> body) {
        List<String> leadIds = body != null ? body.get("leadIds") : List.of();
        return ResponseEntity.ok(leadActivityService.listByLeadIds(leadIds));
    }

    @PostMapping("/activities/stages")
    @PreAuthorize("hasAuthority('leads.read') or hasAuthority('tasks.read')")
    @Operation(summary = "Get max activity stage index per lead (lightweight)")
    public ResponseEntity<Map<String, Integer>> getLeadActivityStages(
            @RequestBody Map<String, List<String>> body) {
        List<String> leadIds = body != null ? body.get("leadIds") : List.of();
        return ResponseEntity.ok(leadActivityService.getMaxStageByLeadIds(leadIds));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get lead by ID")
    public ResponseEntity<LeadDTO> getLeadById(@PathVariable String id) {
        return ResponseEntity.ok(leadService.findById(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('leads.create')")
    @Operation(summary = "Create a new lead")
    public ResponseEntity<LeadDTO> createLead(@Valid @RequestBody LeadDTO dto) {
        return ResponseEntity.status(HttpStatus.CREATED).body(leadService.create(dto));
    }

    @PostMapping("/facebook")
    @Operation(summary = "Create a lead from Facebook/Zapier webhook payload")
    public ResponseEntity<?> createFacebookLead(
            @RequestHeader(value = "X-Webhook-Token", required = false) String webhookToken,
            @RequestBody Map<String, Object> payload) {
        if (!isFacebookIngestionAuthorized(webhookToken)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                "error", "Unauthorized webhook token"
            ));
        }

        String leadgenId = pickString(payload, "leadgen_id", "lead_id", "id");
        String name = pickString(payload, "name", "full_name", "first_name");
        String email = pickString(payload, "email");
        String phone = pickString(payload, "phone", "phone_number", "mobile", "mobile_number");
        String company = pickString(payload, "company", "company_name");
        String designation = pickString(payload, "designation", "job_title", "work_job_title");
        String service = pickString(payload, "service", "service_name");
        String specialization = pickString(payload, "specialization", "sub_service", "subservice");
        String formName = pickString(payload, "form", "form_name");
        String campaign = pickString(payload, "campaign", "campaign_name");
        String adId = pickString(payload, "ad_id", "adid");
        String formId = pickString(payload, "form_id", "formid");

        if (name == null || name.isBlank() || email == null || email.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "name and email are required"
            ));
        }

        LeadDTO dto = LeadDTO.builder()
                .name(name.trim())
                .email(email.trim())
                .phone(phone)
                .company(company)
                .designation(designation)
                .service(service)
                .specialization(specialization)
                .source(Lead.LeadSource.META_ADS)
                .status(Lead.LeadStatus.NEW)
                .utmSource("facebook")
                .utmMedium("lead_ads")
                .utmCampaign(campaign)
                .facebookLeadId(leadgenId)
                .facebookFormId(formId)
                .facebookAdId(adId)
                .notes(buildFacebookLeadNotes(payload, formName, campaign, leadgenId))
                .build();

        LeadDTO saved = leadService.create(dto);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "message", "Lead saved successfully",
                "leadId", saved.getId(),
                "facebookLeadId", leadgenId != null ? leadgenId : "",
                "receivedKeys", payload.keySet()
        ));
    }

    @PostMapping("/facebook-sync")
    @PreAuthorize("hasAuthority('integrations.manage') or hasAuthority('leads.import')")
    @Operation(summary = "Sync historical Facebook Lead Ads data for configured page/forms")
    public ResponseEntity<Map<String, Object>> syncFacebookLeads(
            @RequestBody(required = false) Map<String, String> options) {
        return ResponseEntity.ok(leadService.syncFacebookLeadAds(options));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('leads.update')")
    @Operation(summary = "Update lead")
    public ResponseEntity<LeadDTO> updateLead(@PathVariable String id, @Valid @RequestBody LeadDTO dto) {
        return ResponseEntity.ok(leadService.update(id, dto));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('leads.delete')")
    @Operation(summary = "Delete lead")
    public ResponseEntity<Void> deleteLead(@PathVariable String id) {
        leadService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/bulk-delete")
    @PreAuthorize("hasAuthority('leads.delete')")
    @Operation(summary = "Bulk delete leads")
    public ResponseEntity<Map<String, Integer>> bulkDelete(@RequestBody Map<String, List<String>> body) {
        int count = leadService.bulkDelete(body.get("ids"));
        return ResponseEntity.ok(Map.of("deleted", count));
    }

    @PostMapping("/import")
    @PreAuthorize("hasAuthority('leads.import')")
    @Operation(summary = "Import leads from CSV/Excel")
    public ResponseEntity<Map<String, Object>> importLeads(@RequestParam("file") MultipartFile file) {
        var result = leadService.importFromFile(file);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/export")
    @PreAuthorize("hasAuthority('leads.export')")
    @Operation(summary = "Export leads to CSV/Excel")
    public ResponseEntity<byte[]> exportLeads(
            @RequestParam(defaultValue = "csv") String format,
            @RequestParam(required = false) String status) {
        byte[] data = leadService.export(format, status);
        String normalized = format == null ? "csv" : format.trim().toLowerCase(java.util.Locale.ROOT);
        String contentType;
        switch (normalized) {
            case "pdf":  contentType = "application/pdf"; break;
            case "xlsx": contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; break;
            default:     contentType = "text/csv"; normalized = "csv"; break;
        }
        String filename = "leads." + normalized;
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=" + filename)
                .header("Content-Type", contentType)
                .body(data);
    }

    @PostMapping("/{id}/score")
    @PreAuthorize("hasAuthority('ai.use')")
    @Operation(summary = "Trigger AI lead scoring")
    public ResponseEntity<Map<String, Object>> scoreLead(@PathVariable String id) {
        return ResponseEntity.ok(leadService.scoreWithAI(id));
    }

    @GetMapping("/duplicates")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Find duplicate leads by email or phone")
    public ResponseEntity<List<LeadDTO>> findDuplicates(
            @RequestParam(required = false) String email,
            @RequestParam(required = false) String phone,
            @RequestParam(required = false) String excludeId) {
        return ResponseEntity.ok(leadService.findDuplicates(email, phone, excludeId));
    }

    @PostMapping("/{id}/merge")
    @PreAuthorize("hasAuthority('leads.merge')")
    @Operation(summary = "Merge a duplicate lead into the primary lead")
    public ResponseEntity<LeadDTO> mergeLead(
            @PathVariable String id,
            @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(leadService.merge(id, body != null ? body.get("duplicateId") : null));
    }

    @PostMapping("/{id}/reopen")
    @PreAuthorize("hasAuthority('leads.reopen')")
    @Operation(summary = "Reopen a lost lead")
    public ResponseEntity<LeadDTO> reopenLead(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body) {
        return ResponseEntity.ok(leadService.reopen(id, body));
    }

    @GetMapping("/{id}/aging")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get lead aging and SLA metrics")
    public ResponseEntity<Map<String, Object>> leadAging(@PathVariable String id) {
        return ResponseEntity.ok(leadService.leadAging(id));
    }

    @GetMapping("/{id}/assignment-history")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get lead assignment history")
    public ResponseEntity<List<String>> assignmentHistory(@PathVariable String id) {
        return ResponseEntity.ok(leadService.assignmentHistory(id));
    }

    @GetMapping("/{id}/activities")
    @PreAuthorize("hasAuthority('leads.read')")
    @Operation(summary = "Get lead activities")
    public ResponseEntity<List<LeadActivityDTO>> getLeadActivities(@PathVariable String id) {
        return ResponseEntity.ok(leadActivityService.listByLeadId(id));
    }

    @PostMapping("/{id}/activities")
    @PreAuthorize("hasAuthority('leads.update')")
    @Operation(summary = "Save lead activity")
    public ResponseEntity<LeadActivityDTO> addLeadActivity(
            @PathVariable String id,
            @Valid @RequestBody LeadActivityDTO dto) {
        return ResponseEntity.status(HttpStatus.CREATED).body(leadActivityService.create(id, dto));
    }

    @PutMapping("/{id}/activities/{activityId}")
    @PreAuthorize("hasAuthority('leads.update')")
    @Operation(summary = "Update lead activity")
    public ResponseEntity<LeadActivityDTO> updateLeadActivity(
            @PathVariable String id,
            @PathVariable String activityId,
            @Valid @RequestBody LeadActivityDTO dto) {
        return ResponseEntity.ok(leadActivityService.update(id, activityId, dto));
    }

    @PostMapping(value = "/{id}/recordings", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('leads.update')")
    @Operation(summary = "Upload lead call recording")
    public ResponseEntity<LeadActivityDTO> uploadCallRecording(
            @PathVariable String id,
            @RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(leadActivityService.uploadRecording(id, file));
    }

    @GetMapping("/recordings/{activityId}")
    @PreAuthorize("hasAuthority('leads.read') or hasAuthority('tasks.read')")
    @Operation(summary = "Download lead call recording")
    public ResponseEntity<Resource> downloadCallRecording(@PathVariable String activityId) {
        LeadActivityService.RecordingResource recording = leadActivityService.loadRecording(activityId);
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(recording.contentType()))
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + recording.filename().replace("\"", "") + "\"")
            .body(recording.resource());
    }

    @PostMapping("/{id}/convert")
    @PreAuthorize("hasAuthority('customers.create') and hasAuthority('deals.create')")
    @Operation(summary = "Convert lead to customer and create deal")
    public ResponseEntity<Map<String, Object>> convertLead(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> options) {
        return ResponseEntity.ok(leadService.convertToCustomer(id, options));
    }

    @PostMapping("/{id}/call")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Trigger outbound call for lead")
    public ResponseEntity<Map<String, Object>> callLead(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, String> body) {
        String script = body != null ? body.get("script") : null;
        String setup = body != null ? (body.get("setup") != null ? body.get("setup") : body.get("provider")) : null;
        String fromNumber = body != null ? body.get("fromNumber") : null;
        String toNumber = body != null ? body.get("toNumber") : null;
        return ResponseEntity.ok(leadService.callLeadNow(id, script, setup, fromNumber, toNumber));
    }

    private String pickString(Map<String, Object> payload, String... keys) {
        for (String key : keys) {
            Object value = pickValue(payload, key);
            String text = toPlainString(value);
            if (text != null && !text.isBlank()) {
                return text;
            }
        }
        return null;
    }

    private Object pickValue(Map<String, Object> payload, String key) {
        if (payload.containsKey(key)) {
            return payload.get(key);
        }
        String normalized = normalizeKey(key);
        for (Map.Entry<String, Object> entry : payload.entrySet()) {
            if (normalizeKey(entry.getKey()).equals(normalized)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private String toPlainString(Object value) {
        if (value == null) return null;
        if (value instanceof String s) {
            String trimmed = s.trim();
            return trimmed.isBlank() ? null : trimmed;
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        if (value instanceof List<?> list) {
            String joined = list.stream()
                .map(this::toPlainString)
                .filter(v -> v != null && !v.isBlank())
                .collect(Collectors.joining(", "));
            return joined.isBlank() ? null : joined;
        }
        if (value instanceof Map<?, ?> nested) {
            Object preferred = nested.get("value");
            if (preferred == null) preferred = nested.get("text");
            if (preferred == null) preferred = nested.get("label");
            if (preferred == null) preferred = nested.get("name");
            String extracted = toPlainString(preferred);
            if (extracted != null && !extracted.isBlank()) return extracted;
        }
        String fallback = String.valueOf(value).trim();
        return fallback.isBlank() ? null : fallback;
    }

    private String buildFacebookLeadNotes(Map<String, Object> payload, String formName, String campaign, String leadgenId) {
        StringBuilder notes = new StringBuilder("Facebook Lead");
        if (formName != null && !formName.isBlank()) {
            notes.append(" | Form: ").append(formName.trim());
        }
        if (campaign != null && !campaign.isBlank()) {
            notes.append(" | Campaign: ").append(campaign.trim());
        }
        if (leadgenId != null && !leadgenId.isBlank()) {
            notes.append(" | Leadgen ID: ").append(leadgenId.trim());
        }
        notes.append(" | Received At: ").append(LocalDateTime.now(java.time.ZoneId.of("Asia/Kolkata")));
        notes.append("\n\nRaw Payload:\n");
        notes.append(toPrettyJson(payload));
        return notes.toString();
    }

    private String toPrettyJson(Map<String, Object> payload) {
        try {
            return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            return String.valueOf(payload);
        }
    }

    private String normalizeKey(String key) {
        if (key == null) return "";
        return key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private boolean isFacebookIngestionAuthorized(String providedToken) {
        String expected = facebookIngestionToken == null ? "" : facebookIngestionToken.trim();
        if (expected.isBlank()) {
            return false;
        }
        String provided = providedToken == null ? "" : providedToken.trim();
        return expected.equals(provided);
    }
}
