-- Dev seed: two business units, three instrument models, a realistic catalogue.
-- Applied by the API when SMS_SEED_DEV=true and no business unit exists. Users are created in code (Bootstrap.cs).

INSERT INTO business_unit(id, code, name, bu_type, address, opening_due_time, closing_due_time) VALUES
  ('11111111-1111-1111-1111-111111111111', 'DEL-CENTRAL', 'Delhi Central Lab', 'lab', 'Nehru Place, New Delhi', '09:00', '21:00'),
  ('22222222-2222-2222-2222-222222222222', 'GGN-SOUTH', 'Gurugram South Lab', 'lab', 'Sector 49, Gurugram', '08:30', '20:30');

INSERT INTO instrument_model(id, manufacturer, model_name, category) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Sysmex', 'XN-550', 'haematology'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Roche', 'cobas c311', 'biochemistry'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Abbott', 'Architect i1000SR', 'immunoassay');

INSERT INTO supplier(name, contact) VALUES ('Sysmex India', 'orders@sysmex.example'), ('Roche Diagnostics India', 'dealer@roche.example'), ('Medline Supplies', 'sales@medline.example');

-- Sysmex XN-550 reagents
INSERT INTO item(code, name, kind, category, manufacturer, base_uom, pack_size, pack_uom, storage, instrument_model_id, default_min_level) VALUES
  ('RG-XN-CELLPACK', 'CELLPACK DCL', 'reagent', 'haematology', 'Sysmex', 'mL', 20000, 'cubitainer', 'room', 'aaaaaaaa-0000-0000-0000-000000000001', 20000),
  ('RG-XN-LYSERCELL', 'Lysercell WNR', 'reagent', 'haematology', 'Sysmex', 'mL', 1500, 'bottle', 'room', 'aaaaaaaa-0000-0000-0000-000000000001', 1500),
  ('RG-XN-FLUORO-WNR', 'Fluorocell WNR', 'reagent', 'haematology', 'Sysmex', 'mL', 82, 'vial', 'room', 'aaaaaaaa-0000-0000-0000-000000000001', 82),
  ('RG-XN-SULFOLYSER', 'Sulfolyser', 'reagent', 'haematology', 'Sysmex', 'mL', 1500, 'bottle', 'room', 'aaaaaaaa-0000-0000-0000-000000000001', 1500),
  ('QC-XN-CHECK', 'XN CHECK Level 2', 'control', 'haematology', 'Sysmex', 'mL', 3, 'vial', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000001', 3);

-- Roche cobas c311 reagents
INSERT INTO item(code, name, kind, category, manufacturer, base_uom, pack_size, pack_uom, storage, instrument_model_id, default_min_level) VALUES
  ('RG-C311-GLUC', 'Glucose HK Gen.3', 'reagent', 'biochemistry', 'Roche', 'test', 800, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000002', 400),
  ('RG-C311-CREA', 'Creatinine Jaffe Gen.2', 'reagent', 'biochemistry', 'Roche', 'test', 700, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000002', 350),
  ('RG-C311-ALT', 'ALT/GPT', 'reagent', 'biochemistry', 'Roche', 'test', 500, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000002', 250),
  ('RG-C311-CHOL', 'Cholesterol Gen.2', 'reagent', 'biochemistry', 'Roche', 'test', 400, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000002', 200),
  ('CAL-C311-CFAS', 'Calibrator f.a.s.', 'calibrator', 'biochemistry', 'Roche', 'mL', 12, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000002', 6),
  ('RG-C311-ACTIV', 'Activator', 'reagent', 'biochemistry', 'Roche', 'mL', 1800, 'bottle', 'room', 'aaaaaaaa-0000-0000-0000-000000000002', 1800);

-- Abbott Architect reagents
INSERT INTO item(code, name, kind, category, manufacturer, base_uom, pack_size, pack_uom, storage, instrument_model_id, default_min_level) VALUES
  ('RG-ARC-TSH', 'TSH Reagent Kit', 'reagent', 'immunoassay', 'Abbott', 'test', 100, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000003', 100),
  ('RG-ARC-FT4', 'Free T4 Reagent Kit', 'reagent', 'immunoassay', 'Abbott', 'test', 100, 'kit', 'fridge_2_8', 'aaaaaaaa-0000-0000-0000-000000000003', 100),
  ('RG-ARC-TRIGGER', 'Pre-Trigger / Trigger Solution', 'reagent', 'immunoassay', 'Abbott', 'mL', 975, 'bottle', 'room', 'aaaaaaaa-0000-0000-0000-000000000003', 975);

-- General materials and consumables (no instrument)
INSERT INTO item(code, name, kind, category, base_uom, pack_size, pack_uom, tracks_lot, tracks_expiry, default_min_level) VALUES
  ('MT-GLOVES-M', 'Nitrile gloves, medium', 'material', 'PPE', 'piece', 100, 'box', false, false, 300),
  ('MT-GLOVES-L', 'Nitrile gloves, large', 'material', 'PPE', 'piece', 100, 'box', false, false, 200),
  ('CS-TIP-1000', 'Pipette tips 1000 µL', 'consumable', 'lab ware', 'piece', 1000, 'bag', false, false, 2000),
  ('CS-TIP-200', 'Pipette tips 200 µL', 'consumable', 'lab ware', 'piece', 1000, 'bag', false, false, 2000),
  ('CS-CUP-SAMPLE', 'Sample cups 2 mL', 'consumable', 'lab ware', 'piece', 500, 'bag', false, false, 1000),
  ('CS-EDTA-3ML', 'EDTA vacutainer 3 mL', 'consumable', 'phlebotomy', 'piece', 100, 'rack', true, true, 500),
  ('CS-SST-5ML', 'SST vacutainer 5 mL', 'consumable', 'phlebotomy', 'piece', 100, 'rack', true, true, 500),
  ('CS-NEEDLE-21G', 'Vacutainer needles 21G', 'consumable', 'phlebotomy', 'piece', 100, 'box', true, true, 300),
  ('MT-ALCOHOL-SWAB', 'Alcohol swabs', 'material', 'phlebotomy', 'piece', 200, 'box', false, false, 400),
  ('MT-PRINTER-LABEL', 'Barcode labels roll', 'material', 'stationery', 'piece', 1000, 'roll', false, false, 2000);

-- Instruments per BU
INSERT INTO instrument(id, bu_id, instrument_model_id, serial_no, label, installed_on) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'XN5-24117', 'XN-550 · Bench A', '2024-03-12'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'C311-9082', 'cobas c311 · Bench B', '2023-11-01'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'ARC-55021', 'Architect · Immuno room', '2024-06-20'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'XN5-25604', 'XN-550', '2025-01-15'),
  ('bbbbbbbb-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'C311-9311', 'cobas c311', '2025-01-15');

-- BU items: every model reagent for each instrument, plus general items for both BUs
INSERT INTO bu_item(bu_id, item_id, instrument_id, min_level)
SELECT ins.bu_id, i.id, ins.id, i.default_min_level
FROM instrument ins JOIN item i ON i.instrument_model_id = ins.instrument_model_id;

INSERT INTO bu_item(bu_id, item_id, min_level)
SELECT b.id, i.id, i.default_min_level FROM business_unit b CROSS JOIN item i WHERE i.instrument_model_id IS NULL;
