export const SOFTWARE_NAME = "I Store";
export const DEFAULT_SHOP_NAME = "I Point";

export function normalizeStoreProfile(profile = {}, printProfile = {}) {
  const business = profile?.business_identity || {};
  const contact = profile?.contact_information || {};
  const address = profile?.address || {};
  const operations = profile?.operational_details || {};
  const logo = profile?.logo_branding || {};
  const logoAssets = logo?.logo_assets || {};

  return {
    softwareName: SOFTWARE_NAME,
    shopName: business.shop_name || printProfile.store_name || DEFAULT_SHOP_NAME,
    tagline: business.shop_tagline || printProfile.slogan || "",
    address: [address.address_line_1 || printProfile.store_address, address.address_line_2, address.city, address.district]
      .filter(Boolean)
      .join(", "),
    phone: contact.primary_phone || printProfile.store_phone || "",
    secondaryPhone: contact.secondary_phone || "",
    email: contact.email_address || printProfile.store_email || "",
    website: contact.website_url || printProfile.store_website || "",
    taxNumber: business.tax_vat_number || printProfile.tax_number || "",
    registrationNumber: business.registration_number || printProfile.business_reg_no || "",
    logoData: logo.shop_logo || logoAssets.main || printProfile.logo_data || "",
    invoiceFooter: operations.invoice_footer_text || printProfile.footer_note || "Thank you. Visit again.",
    warrantyTerms: operations.warranty_terms || "",
    receiptMessage: operations.receipt_message || printProfile.footer_note || "Thank you. Visit again.",
  };
}

export function normalizePrintProfile(printProfile = {}) {
  const identity = normalizeStoreProfile({}, printProfile || {});
  return {
    ...printProfile,
    store_name: identity.shopName,
    store_address: identity.address,
    store_phone: identity.phone,
    store_email: identity.email,
    store_website: identity.website,
    footer_note: identity.invoiceFooter,
    logo_data: identity.logoData,
  };
}
