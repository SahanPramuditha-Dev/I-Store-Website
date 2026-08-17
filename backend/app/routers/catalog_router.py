from datetime import datetime
import itertools
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import (
    MasterProduct,
    ProductAttribute,
    AttributeValue,
    AttributePreset,
    ProductVariant,
    VariantAttributeValue,
    VariantPrice,
    VariantPriceHistory,
    InventoryItem,
    InventorySerial,
    Brand,
    ProductCategory,
    ProductType,
    IMEIMovementLog,
    ProductBundle,
    BundleItem,
)
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/catalog", tags=["catalog"])


# --- PRODUCT TYPES ---
@router.get("/product-types", dependencies=[Depends(require_permission("inventory.view"))])
def list_product_types(db: Session = Depends(get_db), _=Depends(get_current_user)):
    types = db.query(ProductType).all()
    if not types:
        # Seed default product types if empty
        defaults = [
            {"name": "Mobile Phone", "requires_serialization": True, "requires_inventory": True, "description": "IMEI & serial number tracked smart devices"},
            {"name": "Accessory", "requires_serialization": False, "requires_inventory": True, "description": "Cables, cases, chargers (quantity batch tracked)"},
            {"name": "Spare Part", "requires_serialization": False, "requires_inventory": True, "description": "Displays, batteries, repair components"},
            {"name": "Service", "requires_serialization": False, "requires_inventory": False, "description": "Labor, repair service, software flash"},
        ]
        for d in defaults:
            pt = ProductType(**d)
            db.add(pt)
        db.commit()
        types = db.query(ProductType).all()
    return [{"id": t.id, "name": t.name, "requires_serialization": t.requires_serialization, "requires_inventory": t.requires_inventory, "description": t.description} for t in types]


@router.post("/product-types", dependencies=[Depends(require_permission("inventory.manage"))])
def create_product_type(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product type name is required")
    existing = db.query(ProductType).filter(func.lower(ProductType.name) == name.lower()).first()
    if existing:
        return {"id": existing.id, "name": existing.name}
    
    pt = ProductType(
        name=name,
        requires_serialization=bool(payload.get("requires_serialization", False)),
        requires_inventory=bool(payload.get("requires_inventory", True)),
        description=payload.get("description")
    )
    db.add(pt)
    db.commit()
    db.refresh(pt)
    return {"id": pt.id, "name": pt.name, "requires_serialization": pt.requires_serialization, "requires_inventory": pt.requires_inventory}


@router.put("/product-types/{type_id}", dependencies=[Depends(require_permission("inventory.edit_product"))])
def update_product_type(type_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    pt = db.query(ProductType).filter(ProductType.id == type_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Product type not found")
    name = (payload.get("name") or "").strip()
    if name:
        pt.name = name
    if "requires_serialization" in payload:
        pt.requires_serialization = bool(payload["requires_serialization"])
    if "requires_inventory" in payload:
        pt.requires_inventory = bool(payload["requires_inventory"])
    if "description" in payload:
        pt.description = payload["description"]
    db.commit()
    db.refresh(pt)
    return {"id": pt.id, "name": pt.name, "requires_serialization": pt.requires_serialization, "requires_inventory": pt.requires_inventory, "description": pt.description}


@router.delete("/product-types/{type_id}", dependencies=[Depends(require_permission("inventory.delete_product"))])
def delete_product_type(type_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    pt = db.query(ProductType).filter(ProductType.id == type_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Product type not found")
    db.delete(pt)
    db.commit()
    return {"ok": True}



# --- ATTRIBUTE MANAGEMENT ---
@router.get("/attributes", dependencies=[Depends(require_permission("inventory.view"))])
def list_attributes(db: Session = Depends(get_db), _=Depends(get_current_user)):
    attrs = db.query(ProductAttribute).order_by(ProductAttribute.sort_order.asc(), ProductAttribute.name.asc()).all()
    results = []
    for a in attrs:
        vals = db.query(AttributeValue).filter(AttributeValue.attribute_id == a.id).all()
        results.append({
            "id": a.id,
            "name": a.name,
            "display_name": a.display_name or a.name,
            "values": [{"id": v.id, "value": v.value, "color_code": v.color_code} for v in vals]
        })
    return results


@router.post("/attributes", dependencies=[Depends(require_permission("inventory.manage"))])
def create_attribute(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Attribute name is required")
    
    existing = db.query(ProductAttribute).filter(func.lower(ProductAttribute.name) == name.lower()).first()
    if existing:
        return {"status": "exists", "id": existing.id, "name": existing.name}
    
    attr = ProductAttribute(
        name=name,
        display_name=payload.get("display_name") or name,
        sort_order=int(payload.get("sort_order", 0))
    )
    db.add(attr)
    db.commit()
    db.refresh(attr)
    return {"status": "created", "id": attr.id, "name": attr.name}


@router.delete("/attributes/{attr_id}", dependencies=[Depends(require_permission("inventory.manage"))])
def delete_attribute(attr_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    attr = db.query(ProductAttribute).filter(ProductAttribute.id == attr_id).first()
    if not attr:
        raise HTTPException(status_code=404, detail="Attribute not found")

    in_use = (
        db.query(VariantAttributeValue.id)
        .filter(VariantAttributeValue.attribute_id == attr_id)
        .first()
    )
    if in_use:
        raise HTTPException(status_code=400, detail="This attribute is already used in saved variants and cannot be removed")

    db.delete(attr)
    db.commit()
    return {"status": "deleted", "id": attr_id}


@router.post("/attributes/{attr_id}/values", dependencies=[Depends(require_permission("inventory.manage"))])
def add_attribute_value(attr_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    val = (payload.get("value") or "").strip()
    if not val:
        raise HTTPException(status_code=400, detail="Value is required")
    
    existing = db.query(AttributeValue).filter(
        AttributeValue.attribute_id == attr_id,
        func.lower(AttributeValue.value) == val.lower()
    ).first()
    
    if existing:
        return {"status": "exists", "id": existing.id, "value": existing.value}
    
    attr_val = AttributeValue(
        attribute_id=attr_id,
        value=val,
        color_code=payload.get("color_code")
    )
    db.add(attr_val)
    db.commit()
    db.refresh(attr_val)
    return {"status": "created", "id": attr_val.id, "value": attr_val.value}


@router.delete("/attributes/values/{value_id}", dependencies=[Depends(require_permission("inventory.manage"))])
def delete_attribute_value(value_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    value = db.query(AttributeValue).filter(AttributeValue.id == value_id).first()
    if not value:
        raise HTTPException(status_code=404, detail="Attribute value not found")

    in_use = (
        db.query(VariantAttributeValue.id)
        .filter(VariantAttributeValue.attribute_value_id == value_id)
        .first()
    )
    if in_use:
        raise HTTPException(status_code=400, detail="This value is already used in saved variants and cannot be removed")

    db.delete(value)
    db.commit()
    return {"status": "deleted", "id": value_id}


# --- MASTER PRODUCTS ---
@router.get("/products", dependencies=[Depends(require_permission("inventory.view"))])
def list_master_products(
    q: str = "",
    brand_id: int = None,
    category_id: int = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    query = db.query(MasterProduct)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(MasterProduct.name.ilike(like))
    if brand_id:
        query = query.filter(MasterProduct.brand_id == brand_id)
    if category_id:
        query = query.filter(MasterProduct.category_id == category_id)

    products = query.order_by(MasterProduct.created_at.desc()).all()
    results = []
    for p in products:
        variants = db.query(ProductVariant).filter(ProductVariant.product_id == p.id).all()
        brand_obj = db.query(Brand).filter(Brand.id == p.brand_id).first() if p.brand_id else None
        cat_obj = db.query(ProductCategory).filter(ProductCategory.id == p.category_id).first() if p.category_id else None
        
        variant_data = []
        for v in variants:
            stock = (
                db.query(func.coalesce(func.sum(InventoryItem.quantity), 0))
                .filter(InventoryItem.variant_id == v.id, InventoryItem.is_deleted == False)
                .scalar() or 0
            )
            v_attrs = {}
            for vav in v.attribute_values:
                if vav.attribute and vav.val:
                    v_attrs[vav.attribute.name] = vav.val.value

            variant_data.append({
                "id": v.id,
                "display_name": v.display_name or v.sku,
                "sku": v.sku,
                "barcode": v.barcode,
                "default_selling_price": float(v.default_selling_price or 0),
                "default_cost_price": float(v.default_cost_price or 0),
                "default_wholesale_price": float(v.default_wholesale_price or 0),
                "min_allowed_price": float(v.min_allowed_price or 0),
                "shop_warranty_days": int(v.shop_warranty_days or 0),
                "supplier_warranty_days": int(v.supplier_warranty_days or 0),
                "attributes": v_attrs,
                "status": v.status,
                "stock": int(stock),
            })

        specs = p.specifications
        if isinstance(specs, str) and specs.strip():
            try:
                specs = json.loads(specs)
            except Exception:
                specs = {}
        elif not specs:
            specs = {}

        results.append({
            "id": p.id,
            "name": p.name,
            "brand_id": p.brand_id,
            "category_id": p.category_id,
            "brand": brand_obj.name if brand_obj else None,
            "category": cat_obj.name if cat_obj else None,
            "master_image_url": p.master_image_url,
            "specifications": specs,
            "status": p.status,
            "variant_count": len(variants),
            "variants": variant_data
        })
    return results


@router.post("/products", dependencies=[Depends(require_permission("inventory.manage"))])
def create_master_product(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")

    has_variants = bool(payload.get("has_variants", True))
    
    brand_id = payload.get("brand_id")
    category_id = payload.get("category_id")
    
    specs = payload.get("specifications") or {}
    if isinstance(specs, (dict, list)):
        specs_str = json.dumps(specs)
    else:
        specs_str = str(specs) if specs else None

    def _safe_float(val):
        try:
            return float(val) if val not in (None, "") else 0.0
        except (ValueError, TypeError):
            return 0.0

    mp = MasterProduct(
        name=name,
        brand_id=int(brand_id) if brand_id not in (None, "") else None,
        category_id=int(category_id) if category_id not in (None, "") else None,
        description=payload.get("description"),
        has_variants=has_variants,
        master_image_url=payload.get("master_image_url"),
        barcode_prefix=payload.get("barcode_prefix"),
        specifications=specs_str,
        status=payload.get("status", "ACTIVE")
    )
    db.add(mp)
    db.commit()
    db.refresh(mp)

    # If single product (has_variants = false), generate 1 default variant
    if not has_variants:
        brand_name = "IST"
        if mp.brand_id:
            b = db.query(Brand).filter(Brand.id == mp.brand_id).first()
            if b:
                brand_name = b.name[:3].upper()
        
        default_sku = f"{brand_name}-{name[:4].upper()}-{mp.id}"
        variant = ProductVariant(
            product_id=mp.id,
            sku=default_sku,
            default_selling_price=_safe_float(payload.get("default_selling_price")),
            default_cost_price=_safe_float(payload.get("default_cost_price")),
            is_default=True,
            status="ACTIVE"
        )
        db.add(variant)
        db.commit()

    return {"status": "created", "id": mp.id, "name": mp.name, "has_variants": mp.has_variants}


# --- VARIANT MATRIX GENERATION ---
@router.post("/products/{product_id}/generate-variants-preview", dependencies=[Depends(require_permission("inventory.manage"))])
def generate_variants_preview(product_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    # payload: { attribute_value_ids: [1, 4, 8, 12] }
    mp = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not mp:
        raise HTTPException(status_code=404, detail="Master product not found")

    value_ids = payload.get("attribute_value_ids") or []
    if not value_ids:
        raise HTTPException(status_code=400, detail="Attribute values are required for matrix generation")

    # Group value_ids by attribute_id
    values = db.query(AttributeValue).options(joinedload(AttributeValue.attribute)).filter(AttributeValue.id.in_(value_ids)).all()
    grouped = {}
    for v in values:
        grouped.setdefault(v.attribute_id, []).append(v)

    attribute_lists = list(grouped.values())
    combinations = list(itertools.product(*attribute_lists))

    brand_name = "IST"
    if mp.brand_id:
        b = db.query(Brand).filter(Brand.id == mp.brand_id).first()
        if b:
            brand_name = b.name[:3].upper()

    previews = []
    for idx, combo in enumerate(combinations):
        spec_parts = [v.value.replace(" ", "").upper() for v in combo]
        suggested_sku = f"{brand_name}-{mp.name[:4].upper()}-" + "-".join(spec_parts)
        
        previews.append({
            "id": f"preview-{idx}",
            "selected": True,
            "sku": suggested_sku,
            "combination": [
                {
                    "attribute_id": v.attribute_id,
                    "attribute_name": v.attribute.name if hasattr(v, "attribute") and v.attribute else "Spec",
                    "value_id": v.id,
                    "value": v.value
                }
                for v in combo
            ],
            "default_cost_price": float(payload.get("default_cost_price", 0)),
            "default_selling_price": float(payload.get("default_selling_price", 0)),
        })

    return {"product_id": mp.id, "product_name": mp.name, "count": len(previews), "variants": previews}


@router.post("/products/{product_id}/save-variants", dependencies=[Depends(require_permission("inventory.manage"))])
def save_variants(product_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    # payload: { variants: [ { sku, default_cost_price, default_selling_price, combination: [{attribute_id, value_id}] } ] }
    mp = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not mp:
        raise HTTPException(status_code=404, detail="Master product not found")

    variant_list = payload.get("variants") or []
    created_count = 0

    for item in variant_list:
        sku = item.get("sku", "").strip()
        if not sku:
            continue

        # Check duplicate SKU
        existing_sku = db.query(ProductVariant).filter(ProductVariant.sku == sku).first()
        if existing_sku:
            sku = f"{sku}-{int(datetime.utcnow().timestamp()) % 10000}"

        combo = item.get("combination") or []
        spec_text = " - ".join([str(c.get("value", "")) for c in combo if c.get("value")])
        display_name = f"{mp.name} - {spec_text}" if spec_text else mp.name

        pv = ProductVariant(
            product_id=mp.id,
            master_product_id=mp.id,
            sku=sku,
            barcode=item.get("barcode"),
            display_name=display_name,
            default_cost_price=float(item.get("default_cost_price", 0)),
            default_selling_price=float(item.get("default_selling_price", 0)),
            min_allowed_price=float(item.get("default_cost_price", 0)),
            status="ACTIVE"
        )
        db.add(pv)
        db.commit()
        db.refresh(pv)

        for c in combo:
            vav = VariantAttributeValue(
                variant_id=pv.id,
                attribute_id=c["attribute_id"],
                attribute_value_id=c["value_id"]
            )
            db.add(vav)

        # Default Retail Price Tier
        vp = VariantPrice(
            variant_id=pv.id,
            tier_name="Retail",
            price=float(item.get("default_selling_price", 0))
        )
        db.add(vp)
        db.commit()
        created_count += 1

    return {"status": "success", "created_variants": created_count}


# --- PRESETS & CLONING & ARCHIVING ---
@router.get("/presets", dependencies=[Depends(require_permission("inventory.view"))])
def list_presets(db: Session = Depends(get_db), _=Depends(get_current_user)):
    presets = db.query(AttributePreset).all()
    return [{"id": p.id, "name": p.name, "attribute_ids": p.attribute_ids} for p in presets]


@router.post("/variants/{variant_id}/archive", dependencies=[Depends(require_permission("inventory.manage"))])
def archive_variant(variant_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    pv = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Variant not found")

    # Check active inventory items / serials
    active_items = db.query(InventoryItem).filter(InventoryItem.variant_id == variant_id, InventoryItem.quantity > 0).count()
    if active_items > 0:
        raise HTTPException(status_code=400, detail="Cannot archive variant with remaining active inventory stock.")

    pv.status = "ARCHIVED"
    db.commit()
    return {"status": "success", "message": f"Variant {pv.sku} archived successfully."}


@router.post("/variants/{variant_id}/clone", dependencies=[Depends(require_permission("inventory.manage"))])
def clone_variant(variant_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    pv = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Source variant not found")

    new_sku = (payload.get("new_sku") or f"{pv.sku}-CLONE").strip()
    existing = db.query(ProductVariant).filter(ProductVariant.sku == new_sku).first()
    if existing:
        new_sku = f"{new_sku}-{int(datetime.utcnow().timestamp()) % 1000}"

    new_pv = ProductVariant(
        product_id=pv.product_id,
        sku=new_sku,
        barcode=payload.get("barcode"),
        default_cost_price=float(payload.get("default_cost_price", pv.default_cost_price or 0)),
        default_selling_price=float(payload.get("default_selling_price", pv.default_selling_price or 0)),
        supplier_warranty_days=pv.supplier_warranty_days,
        shop_warranty_days=pv.shop_warranty_days,
        status="ACTIVE"
    )
    db.add(new_pv)
    db.commit()
    db.refresh(new_pv)

    # Clone attribute values
    source_vals = db.query(VariantAttributeValue).filter(VariantAttributeValue.variant_id == variant_id).all()
    for sv in source_vals:
        vav = VariantAttributeValue(
            variant_id=new_pv.id,
            attribute_id=sv.attribute_id,
            attribute_value_id=sv.attribute_value_id
        )
        db.add(vav)

    db.commit()
    return {"status": "success", "cloned_variant_id": new_pv.id, "sku": new_pv.sku}


@router.delete("/products/{product_id}", dependencies=[Depends(require_permission("inventory.manage"))])
def delete_master_product(product_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    mp = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not mp:
        raise HTTPException(status_code=404, detail="Master product not found")

    # Check active inventory items linked to variants of this product
    active_items = (
        db.query(InventoryItem)
        .join(ProductVariant, InventoryItem.variant_id == ProductVariant.id)
        .filter(ProductVariant.product_id == product_id, InventoryItem.quantity > 0)
        .count()
    )
    if active_items > 0:
        raise HTTPException(status_code=400, detail="Cannot delete product with active inventory stock.")

    db.delete(mp)
    db.commit()
    return {"status": "success", "message": f"Product '{mp.name}' deleted successfully."}


@router.put("/variants/{variant_id}", dependencies=[Depends(require_permission("inventory.manage"))])
def update_variant(variant_id: int, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    pv = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Variant not found")

    if "sku" in payload and payload["sku"].strip():
        new_sku = payload["sku"].strip()
        dup = db.query(ProductVariant).filter(ProductVariant.sku == new_sku, ProductVariant.id != variant_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"SKU '{new_sku}' already exists.")
        pv.sku = new_sku

    if "barcode" in payload:
        pv.barcode = payload["barcode"].strip() if payload["barcode"] else None
    if "default_selling_price" in payload:
        pv.default_selling_price = float(payload["default_selling_price"] or 0)
    if "default_cost_price" in payload:
        pv.default_cost_price = float(payload["default_cost_price"] or 0)
    if "status" in payload:
        pv.status = payload["status"]

    db.commit()
    db.refresh(pv)
    return {"status": "success", "variant": {"id": pv.id, "sku": pv.sku, "barcode": pv.barcode, "default_selling_price": pv.default_selling_price, "default_cost_price": pv.default_cost_price, "status": pv.status}}


@router.post("/presets", dependencies=[Depends(require_permission("inventory.manage"))])
def create_preset(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    attribute_ids = payload.get("attribute_ids") or []
    if not name:
        raise HTTPException(status_code=400, detail="Preset name is required")
    if not attribute_ids:
        raise HTTPException(status_code=400, detail="Attribute IDs are required")

    existing = db.query(AttributePreset).filter(AttributePreset.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Preset with this name already exists")

    preset = AttributePreset(
        name=name,
        attribute_ids=json.dumps(attribute_ids) if isinstance(attribute_ids, list) else str(attribute_ids)
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return {"id": preset.id, "name": preset.name, "attribute_ids": preset.attribute_ids}


# --- FAST LIGHTWEIGHT POS SEARCH ENDPOINT ---
@router.get("/variants/pos-search", dependencies=[Depends(require_permission("pos.access"))])
def search_pos_variants(q: str = "", db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Fast POS terminal search for barcode scanners or cashiers (under 50ms)."""
    search_str = q.strip()
    query = db.query(ProductVariant).options(joinedload(ProductVariant.product))

    if search_str:
        like_pattern = f"%{search_str}%"
        query = query.filter(
            or_(
                ProductVariant.barcode == search_str,
                ProductVariant.sku.ilike(like_pattern),
                ProductVariant.display_name.ilike(like_pattern),
                MasterProduct.name.ilike(like_pattern)
            )
        )

    variants = query.filter(ProductVariant.status == "ACTIVE").limit(30).all()
    results = []

    for v in variants:
        master_name = v.product.name if v.product else "Item"
        display_name = v.display_name or f"{master_name} ({v.sku})"
        
        # Calculate stock
        stock = (
            db.query(func.coalesce(func.sum(InventoryItem.quantity), 0))
            .filter(InventoryItem.variant_id == v.id, InventoryItem.is_deleted == False)
            .scalar() or 0
        )

        results.append({
            "variant_id": v.id,
            "sku": v.sku,
            "barcode": v.barcode,
            "display_name": display_name,
            "master_product_name": master_name,
            "selling_price": float(v.default_selling_price or 0),
            "cost_price": float(v.default_cost_price or 0),
            "min_allowed_price": float(v.min_allowed_price or 0),
            "max_discount_amount": float(v.max_discount_amount or 0) if hasattr(v, 'max_discount_amount') else 0,
            "max_discount_percent": float(v.max_discount_percent or 0) if hasattr(v, 'max_discount_percent') else 0,
            "available_stock": int(stock),
            "image_url": v.image_url or (v.product.master_image_url if v.product else None),
        })

    return results


# --- PRODUCT BUNDLES ---
class BundleItemIn(BaseModel):
    inventory_item_id: int  # maps to variant_id in db model
    quantity: int

class BundleIn(BaseModel):
    name: str
    description: Optional[str] = None
    bundle_price: float
    items: List[BundleItemIn]


@router.get("/bundles", dependencies=[Depends(require_permission("catalog.view"))])
def list_bundles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    bundles = db.query(ProductBundle).options(joinedload(ProductBundle.items)).all()
    results = []
    for b in bundles:
        results.append({
            "id": b.id,
            "name": b.name,
            "bundle_sku": b.bundle_sku,
            "bundle_price": b.bundle_price,
            "created_at": b.created_at,
            "items": [{"variant_id": item.variant_id, "quantity": item.quantity} for item in b.items]
        })
    return results


@router.post("/bundles", dependencies=[Depends(require_permission("catalog.manage"))])
def create_bundle(payload: BundleIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    import uuid
    bundle = ProductBundle(
        name=payload.name,
        bundle_sku=f"BNDL-{str(uuid.uuid4())[:8].upper()}",
        bundle_price=payload.bundle_price
    )
    db.add(bundle)
    db.commit()
    db.refresh(bundle)
    
    for item in payload.items:
        bi = BundleItem(
            bundle_id=bundle.id,
            variant_id=item.inventory_item_id, # Mapping inventory_item_id from input to variant_id
            quantity=item.quantity
        )
        db.add(bi)
    db.commit()
    db.refresh(bundle)
    return {"id": bundle.id, "name": bundle.name, "bundle_price": bundle.bundle_price, "bundle_sku": bundle.bundle_sku}


@router.get("/bundles/{bundle_id}", dependencies=[Depends(require_permission("catalog.view"))])
def get_bundle(bundle_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    bundle = db.query(ProductBundle).options(joinedload(ProductBundle.items)).filter(ProductBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return {
        "id": bundle.id,
        "name": bundle.name,
        "bundle_sku": bundle.bundle_sku,
        "bundle_price": bundle.bundle_price,
        "created_at": bundle.created_at,
        "items": [{"variant_id": item.variant_id, "quantity": item.quantity} for item in bundle.items]
    }


@router.put("/bundles/{bundle_id}", dependencies=[Depends(require_permission("catalog.manage"))])
def update_bundle(bundle_id: int, payload: BundleIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    bundle = db.query(ProductBundle).filter(ProductBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    
    bundle.name = payload.name
    bundle.bundle_price = payload.bundle_price
    db.commit()
    return {"status": "success", "id": bundle.id}


@router.delete("/bundles/{bundle_id}", dependencies=[Depends(require_permission("catalog.manage"))])
def delete_bundle(bundle_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    bundle = db.query(ProductBundle).filter(ProductBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    db.delete(bundle)
    db.commit()
    return {"status": "success"}
