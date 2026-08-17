import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

export default function WhatsAppSettingsCard() {
    const navigate = useNavigate();
    const [status, setStatus] = useState('LOADING'); // LOADING, UNPAIRED, CONNECTED, DISCONNECTED, ERROR
    const [qrCodeUrl, setQrCodeUrl] = useState(null);
    const [user, setUser] = useState(null);
    const [testPhone, setTestPhone] = useState('');
    const [testMsg, setTestMsg] = useState('Hello from I Store POS!');
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState('');

    const fetchStatus = async () => {
        try {
            const res = await api.get('/api/whatsapp/overview');
            const data = res.data;
            if (data && data.service) {
                setStatus(data.service.status || 'OFFLINE');
                setQrCodeUrl(data.service.qrCodeUrl || null);
                setUser(data.service.user || null);
            } else {
                setStatus('ERROR');
            }
        } catch (err) {
            setStatus('OFFLINE');
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleSendTestMessage = async (e) => {
        e.preventDefault();
        if (!testPhone) return;

        setSending(true);
        setFeedback('');

        try {
            const res = await api.post('/api/whatsapp/send-direct', {
                phone: testPhone, message: testMsg
            });
            const data = res.data;
            if (data.success || data.message_id) {
                setFeedback('✅ Message sent successfully!');
            } else {
                const errText = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error || 'Failed to send message');
                setFeedback(`❌ Failed: ${errText}`);
            }
        } catch (err) {
            setFeedback('❌ Error connecting to WhatsApp service.');
        } finally {
            setSending(false);
        }
    };

    return (
        <div style={{
            padding: '24px',
            borderRadius: '12px',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            maxWidth: '560px',
            fontFamily: 'sans-serif'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '24px' }}>💬</span>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                        WhatsApp Integration (No API)
                    </h3>
                </div>
                {status === 'CONNECTED' && (
                    <span style={{
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        fontSize: '12px',
                        fontWeight: '600'
                    }}>
                        CONNECTED
                    </span>
                )}
                {status === 'UNPAIRED' && (
                    <span style={{
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        backgroundColor: '#fef3c7',
                        color: '#b45309',
                        fontSize: '12px',
                        fontWeight: '600'
                    }}>
                        ACTION REQUIRED
                    </span>
                )}
                {status === 'OFFLINE' && (
                    <span style={{
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        backgroundColor: '#fee2e2',
                        color: '#b91c1c',
                        fontSize: '12px',
                        fontWeight: '600'
                    }}>
                        SERVICE OFFLINE
                    </span>
                )}
            </div>

            <p style={{ color: '#4b5563', fontSize: '14px', marginBottom: '16px' }}>
                Connect your WhatsApp account to automatically send invoices, receipts, and order notifications to customers.
            </p>

            <button
                onClick={() => navigate('/whatsapp')}
                style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '14px',
                    cursor: 'pointer',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                }}
            >
                💬 Launch WhatsApp Manager & Customizer Module →
            </button>

            {/* UNPAIRED STATE: DISPLAY QR CODE */}
            {status === 'UNPAIRED' && (
                <div style={{ textAlign: 'center', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px dashed #d1d5db' }}>
                    <p style={{ fontWeight: '500', color: '#374151', margin: '0 0 12px 0' }}>
                        📱 Scan this QR Code with WhatsApp on your phone:
                    </p>
                    {qrCodeUrl ? (
                        <img 
                            src={qrCodeUrl} 
                            alt="WhatsApp QR Code" 
                            style={{ width: '220px', height: '220px', borderRadius: '8px', border: '1px solid #e5e7eb', display: 'inline-block' }} 
                        />
                    ) : (
                        <div style={{ height: '180px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280', gap: '8px' }}>
                            <span>Generating QR Code...</span>
                            <button 
                                onClick={fetchStatus}
                                style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#e5e7eb', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                🔄 Refresh QR
                            </button>
                        </div>
                    )}
                    <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '12px' }}>
                        Open WhatsApp → Settings → Linked Devices → Link a Device
                    </p>
                </div>
            )}

            {/* CONNECTED STATE */}
            {status === 'CONNECTED' && (
                <div>
                    <div style={{
                        padding: '16px',
                        backgroundColor: '#f0fdf4',
                        borderRadius: '8px',
                        border: '1px solid #bbf7d0',
                        marginBottom: '20px'
                    }}>
                        <p style={{ margin: 0, fontWeight: '600', color: '#166534' }}>
                            ✅ Connected as: {user?.pushname || 'WhatsApp Account'}
                        </p>
                        {user?.wid && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#15803d' }}>
                                Phone Number: +{user.wid}
                            </p>
                        )}
                    </div>

                    <form onSubmit={handleSendTestMessage} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#374151' }}>Test Message</h4>
                        <input
                            type="text"
                            placeholder="Recipient Phone Number (e.g. 94771234567)"
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            style={{
                                padding: '10px 14px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                color: '#0f172a',
                                fontSize: '14px',
                                outline: 'none'
                            }}
                            required
                        />
                        <input
                            type="text"
                            placeholder="Message text..."
                            value={testMsg}
                            onChange={(e) => setTestMsg(e.target.value)}
                            style={{
                                padding: '10px 14px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                color: '#0f172a',
                                fontSize: '14px',
                                outline: 'none'
                            }}
                            required
                        />
                        <button
                            type="submit"
                            disabled={sending}
                            style={{
                                padding: '10px 16px',
                                backgroundColor: '#25d366',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                opacity: sending ? 0.7 : 1
                            }}
                        >
                            {sending ? 'Sending...' : 'Send Test WhatsApp Message'}
                        </button>
                    </form>
                    {feedback && (
                        <p style={{ fontSize: '13px', marginTop: '12px', color: feedback.startsWith('✅') ? '#166534' : '#b91c1c' }}>
                            {feedback}
                        </p>
                    )}

                    <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1f2937', fontWeight: '600' }}>
                            Automated Event Notifications
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#374151' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="checkbox" defaultChecked /> 🧾 POS Sales Receipt (Automatic on Checkout)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="checkbox" defaultChecked /> 🔧 Repair Status Update (Automatic on Status Change)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="checkbox" defaultChecked /> 🛡️ Warranty Expiry Notice (7 Days Prior Cron)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="checkbox" defaultChecked /> 💰 Payment Confirmation (On Payment Logged)
                            </label>
                        </div>
                    </div>

                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <p style={{ margin: 0, fontSize: '12px', fontWeight: '600', color: '#475569' }}>
                            Available Message Template Variables:
                        </p>
                        <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#64748b', lineHeight: '1.5' }}>
                            <code>{"{{customer_name}}"}</code>, <code>{"{{invoice_number}}"}</code>, <code>{"{{invoice_total}}"}</code>, <code>{"{{job_number}}"}</code>, <code>{"{{device_model}}"}</code>, <code>{"{{repair_status}}"}</code>, <code>{"{{balance_due}}"}</code>, <code>{"{{smart_bill_url}}"}</code>
                        </p>
                    </div>
                </div>
            )}

            {/* OFFLINE STATE */}
            {status === 'OFFLINE' && (
                <div style={{ padding: '16px', backgroundColor: '#fef2f2', borderRadius: '8px', color: '#991b1b', fontSize: '14px' }}>
                    <p style={{ margin: 0, fontWeight: '600' }}>⚠️ Microservice is offline</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>
                        Start the service by running <code>cd whatsapp_service &amp;&amp; npm start</code> in your terminal.
                    </p>
                </div>
            )}
        </div>
    );
}
