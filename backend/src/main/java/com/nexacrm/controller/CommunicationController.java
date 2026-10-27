package com.nexacrm.controller;

import com.nexacrm.dto.ChannelSendRequest;
import com.nexacrm.dto.EmailSendRequest;
import com.nexacrm.dto.WhatsAppConversationResponse;
import com.nexacrm.dto.WhatsAppMessageResponse;
import com.nexacrm.service.CommunicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/communications")
@RequiredArgsConstructor
@Tag(name = "Communications", description = "Communication hub endpoints")
public class CommunicationController {

    private final CommunicationService communicationService;

    @PostMapping("/email/send")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Send an email via configured SMTP account")
    public ResponseEntity<Map<String, String>> sendEmail(@Valid @RequestBody EmailSendRequest request) {
        communicationService.sendEmail(request);
        return ResponseEntity.ok(Map.of("message", "Email sent successfully"));
    }

    @PostMapping("/send-channel")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Send a message over any configured channel")
    public ResponseEntity<Map<String, String>> sendChannel(@Valid @RequestBody ChannelSendRequest request) {
        communicationService.sendChannelMessage(
            request.getChannel(),
            request.getRecipient(),
            request.getSubject(),
            request.getBody()
        );
        return ResponseEntity.ok(Map.of("message", "Message sent successfully"));
    }

    @GetMapping("/whatsapp/messages")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get WhatsApp messages by contact number")
    public ResponseEntity<List<WhatsAppMessageResponse>> getWhatsAppMessages(@RequestParam String contact) {
        return ResponseEntity.ok(communicationService.getWhatsAppMessages(contact));
    }

    @GetMapping("/whatsapp/conversations")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get WhatsApp conversation summaries")
    public ResponseEntity<List<WhatsAppConversationResponse>> getWhatsAppConversations() {
        return ResponseEntity.ok(communicationService.getWhatsAppConversations());
    }

    @GetMapping("/whatsapp/all-messages")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get all WhatsApp messages across all contacts")
    public ResponseEntity<List<WhatsAppMessageResponse>> getAllWhatsAppMessages() {
        return ResponseEntity.ok(communicationService.getAllWhatsAppMessages());
    }

    @GetMapping("/whatsapp/openwa/status")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get OpenWA WhatsApp gateway status and active sessions")
    public ResponseEntity<Map<String, Object>> getOpenWAStatus() {
        return ResponseEntity.ok(communicationService.getOpenWAStatus());
    }

    @PostMapping("/whatsapp/openwa/session/start")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Start or create an OpenWA WhatsApp session")
    public ResponseEntity<Map<String, Object>> startOpenWASession(@RequestBody(required = false) Map<String, String> body) {
        String sessionName = body != null ? body.get("name") : null;
        return ResponseEntity.ok(communicationService.startOpenWASession(sessionName));
    }

    @GetMapping("/whatsapp/openwa/qr")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get QR code data URL for session authentication")
    public ResponseEntity<Map<String, Object>> getOpenWAQRCode(@RequestParam(required = false) String sessionId) {
        return ResponseEntity.ok(communicationService.getOpenWAQRCode(sessionId));
    }

    @PostMapping("/whatsapp/openwa/session/logout")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Logout or stop an OpenWA WhatsApp session")
    public ResponseEntity<Map<String, Object>> logoutOpenWASession(@RequestBody(required = false) Map<String, String> body) {
        String sessionId = body != null ? body.get("sessionId") : null;
        return ResponseEntity.ok(communicationService.logoutOpenWASession(sessionId));
    }

    @PostMapping("/whatsapp/openwa/send")
    @PreAuthorize("hasAuthority('communications.send')")
    @Operation(summary = "Send a WhatsApp message directly via OpenWA")
    public ResponseEntity<Map<String, Object>> sendOpenWAMessage(@RequestBody Map<String, String> body) {
        String recipient = body.get("recipient");
        String message = body.get("message");
        if (recipient == null || recipient.isBlank()) {
            throw new IllegalArgumentException("Recipient phone number is required.");
        }
        if (message == null || message.isBlank()) {
            throw new IllegalArgumentException("Message text is required.");
        }
        communicationService.sendChannelMessage("whatsapp", recipient, null, message);
        return ResponseEntity.ok(Map.of("ok", true, "message", "WhatsApp message sent successfully"));
    }

    @GetMapping("/facebook/conversations")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get Facebook Messenger conversation summaries")
    public ResponseEntity<List<WhatsAppConversationResponse>> getFacebookConversations() {
        return ResponseEntity.ok(communicationService.getFacebookConversations());
    }

    @GetMapping("/facebook/messages")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get Facebook Messenger messages by PSID")
    public ResponseEntity<List<WhatsAppMessageResponse>> getFacebookMessages(@RequestParam String psid) {
        return ResponseEntity.ok(communicationService.getFacebookMessages(psid));
    }

    @GetMapping("/instagram/conversations")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get Instagram conversation summaries")
    public ResponseEntity<List<WhatsAppConversationResponse>> getInstagramConversations() {
        return ResponseEntity.ok(communicationService.getInstagramConversations());
    }

    @GetMapping("/instagram/messages")
    @PreAuthorize("hasAuthority('communications.read')")
    @Operation(summary = "Get Instagram messages by IGSID")
    public ResponseEntity<List<WhatsAppMessageResponse>> getInstagramMessages(@RequestParam String igsid) {
        return ResponseEntity.ok(communicationService.getInstagramMessages(igsid));
    }
}
