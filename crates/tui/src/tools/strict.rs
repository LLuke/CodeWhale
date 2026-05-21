//! Strict-mode tool classifier for DeepSeek `/beta` function calling.
//!
//! DeepSeek's strict mode enforces three rules on every JSON Schema object:
//! 1. `additionalProperties: false` on every object
//! 2. All object properties listed in `required`
//! 3. No unsupported keywords (`oneOf`, `allOf`, root-level `anyOf`,
//!    `patternProperties`, `minLength`/`maxLength`, `minItems`/`maxItems`)
//!
//! This module classifies a schema as `Compatible` (already clean),
//! `NeedsAdapter` (can be fixed by `schema_sanitize::sanitize_for_strict`),
//! or `Incompatible` (root-level composition that would change semantics
//! if flattened).
//!
//! The adapter itself lives in [`crate::tools::schema_sanitize`] — this module
//! is the decision layer that tells the engine whether to route a tool through
//! the strict path or fall back.

// Suppress dead_code warnings on items only used from tests until the
// engine wires `classify()` into the strict-tool flow (Phase 5 Exp B).
#![allow(dead_code)]

use serde_json::{Map, Value};

/// Classification of a tool's `input_schema` for DeepSeek strict mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)]
pub enum StrictClassification {
    /// Schema already satisfies all strict-mode rules.
    /// No adapter pass needed; `function.strict = true` safe as-is.
    Compatible,
    /// Schema can be made strict-compatible by
    /// [`crate::tools::schema_sanitize::sanitize_for_strict`].
    /// The adapter is semantics-preserving for this tool.
    NeedsAdapter,
    /// Schema cannot be adapted without semantic loss (root-level
    /// `oneOf`, `allOf`, or multi-branch `anyOf`). Strict mode
    /// must be dropped for this tool.
    Incompatible,
}

/// Classify `schema` for DeepSeek strict-mode compatibility.
///
/// This is a pure, idempotent function — it does not mutate the schema.
/// Call [`crate::tools::schema_sanitize::sanitize_for_strict`] separately
/// when the result is `NeedsAdapter`.
#[must_use]
pub fn classify(schema: &Value) -> StrictClassification {
    if has_strict_incompatible_composition(schema, true) {
        return StrictClassification::Incompatible;
    }
    if is_strict_compatible(schema) {
        return StrictClassification::Compatible;
    }
    StrictClassification::NeedsAdapter
}

/// Returns `true` when the schema already passes the strict-mode checks.
///
/// Checks every object node recursively:
/// - `additionalProperties` is explicitly `false`
/// - Every key in `properties` appears in `required`
/// - No unsupported keywords present
fn is_strict_compatible(schema: &Value) -> bool {
    if let Some(obj) = schema.as_object() {
        // Reject if any unsupported keyword is present
        if has_unsupported_strict_keyword(obj) {
            return false;
        }
        // For object schemas: check additionalProperties and required
        if is_object_schema(obj) {
            if !has_additional_properties_false(obj) {
                return false;
            }
            if !all_properties_required(obj) {
                return false;
            }
        }
        // Recurse into all children
        return obj.values().all(is_strict_compatible);
    }
    if let Some(arr) = schema.as_array() {
        return arr.iter().all(is_strict_compatible);
    }
    // Scalars are trivially compatible
    true
}

/// Root-level `oneOf`, `allOf`, or multi-branch `anyOf` are incompatible.
///
/// `oneOf`/`allOf` are always incompatible. `anyOf` is incompatible only at
/// the root (a nullable-union `anyOf` at any depth is handled by the sanitizer).
fn has_strict_incompatible_composition(schema: &Value, is_root: bool) -> bool {
    if let Some(obj) = schema.as_object() {
        // oneOf and allOf are always incompatible with strict mode
        if obj.contains_key("oneOf") || obj.contains_key("allOf") {
            return true;
        }
        // anyOf at root is incompatible; at depth it may be a nullable union
        if is_root && obj.contains_key("anyOf") {
            return true;
        }
        return obj
            .values()
            .any(|value| has_strict_incompatible_composition(value, false));
    }
    schema.as_array().is_some_and(|arr| {
        arr.iter()
            .any(|value| has_strict_incompatible_composition(value, false))
    })
}

fn has_unsupported_strict_keyword(obj: &Map<String, Value>) -> bool {
    // These keywords are stripped by the sanitizer; their presence means
    // the schema is not already strict-compatible.
    if obj.contains_key("patternProperties") {
        return true;
    }
    if obj.contains_key("oneOf") || obj.contains_key("allOf") || obj.contains_key("anyOf") {
        return true;
    }
    match obj.get("type").and_then(Value::as_str) {
        Some("string") if obj.contains_key("minLength") || obj.contains_key("maxLength") => true,
        Some("array") if obj.contains_key("minItems") || obj.contains_key("maxItems") => true,
        _ => false,
    }
}

fn is_object_schema(obj: &Map<String, Value>) -> bool {
    obj.get("type").and_then(Value::as_str) == Some("object") || obj.contains_key("properties")
}

fn has_additional_properties_false(obj: &Map<String, Value>) -> bool {
    obj.get("additionalProperties").and_then(Value::as_bool) == Some(false)
}

fn all_properties_required(obj: &Map<String, Value>) -> bool {
    let property_keys: Vec<&str> = obj
        .get("properties")
        .and_then(Value::as_object)
        .map(|props| props.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let required_keys: Vec<&str> = obj
        .get("required")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    // Every property must appear in required
    property_keys.iter().all(|k| required_keys.contains(k))
    // Extra required entries with no property are OK (handled by prune_dangling_required)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // === Compatible ===

    #[test]
    fn simple_strict_compatible() {
        let schema = json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "the path"},
                "content": {"type": "string", "description": "the content"}
            },
            "required": ["path", "content"],
            "additionalProperties": false
        });
        assert_eq!(classify(&schema), StrictClassification::Compatible);
    }

    #[test]
    fn nested_strict_compatible() {
        let schema = json!({
            "type": "object",
            "properties": {
                "inner": {
                    "type": "object",
                    "properties": {"x": {"type": "integer"}},
                    "required": ["x"],
                    "additionalProperties": false
                }
            },
            "required": ["inner"],
            "additionalProperties": false
        });
        assert_eq!(classify(&schema), StrictClassification::Compatible);
    }

    // === NeedsAdapter ===

    #[test]
    fn missing_additional_properties() {
        let schema = json!({
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"]
        });
        assert_eq!(classify(&schema), StrictClassification::NeedsAdapter);
    }

    #[test]
    fn incomplete_required() {
        let schema = json!({
            "type": "object",
            "properties": {"path": {"type": "string"}, "raw": {"type": "boolean"}},
            "required": ["path"],
            "additionalProperties": false
        });
        assert_eq!(classify(&schema), StrictClassification::NeedsAdapter);
    }

    #[test]
    fn has_unsupported_keyword_pattern_properties() {
        let schema = json!({
            "type": "object",
            "patternProperties": {"^S_": {"type": "string"}},
            "additionalProperties": false
        });
        assert_eq!(classify(&schema), StrictClassification::NeedsAdapter);
    }

    #[test]
    fn has_min_max_length() {
        let schema = json!({
            "type": "object",
            "properties": {
                "name": {"type": "string", "minLength": 1, "maxLength": 100}
            },
            "required": ["name"],
            "additionalProperties": false
        });
        assert_eq!(classify(&schema), StrictClassification::NeedsAdapter);
    }

    // === Incompatible ===

    #[test]
    fn root_oneof() {
        let schema = json!({
            "oneOf": [
                {"type": "object", "properties": {"changes": {"type": "array"}}, "required": ["changes"], "additionalProperties": false},
                {"type": "object", "properties": {"patch": {"type": "string"}}, "required": ["patch"], "additionalProperties": false}
            ]
        });
        assert_eq!(classify(&schema), StrictClassification::Incompatible);
    }

    #[test]
    fn root_anyof() {
        let schema = json!({
            "anyOf": [
                {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"], "additionalProperties": false},
                {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"], "additionalProperties": false}
            ]
        });
        assert_eq!(classify(&schema), StrictClassification::Incompatible);
    }

    #[test]
    fn root_allof() {
        let schema = json!({
            "allOf": [
                {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": false},
                {"type": "object", "properties": {"b": {"type": "integer"}}, "required": ["b"], "additionalProperties": false}
            ]
        });
        assert_eq!(classify(&schema), StrictClassification::Incompatible);
    }

    // === Idempotent ===

    #[test]
    fn adapter_idempotent_on_already_strict() {
        use crate::tools::schema_sanitize;
        let original = json!({
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
            "additionalProperties": false
        });
        let mut adapted = original.clone();
        schema_sanitize::sanitize_for_strict(&mut adapted);
        // Should be unchanged — already strict
        assert_eq!(adapted, original);
        assert_eq!(classify(&adapted), StrictClassification::Compatible);
    }

    #[test]
    fn adapter_makes_needs_adapter_strict_compatible() {
        use crate::tools::schema_sanitize;
        let mut schema = json!({
            "type": "object",
            "properties": {"path": {"type": "string"}, "raw": {"type": "boolean"}},
            "required": ["path"]
        });
        assert_eq!(classify(&schema), StrictClassification::NeedsAdapter);
        schema_sanitize::sanitize_for_strict(&mut schema);
        assert_eq!(classify(&schema), StrictClassification::Compatible);
    }

    // === Full registry classification ===

    #[allow(clippy::print_stdout)]
    #[tokio::test]
    async fn classify_registry() {
        use crate::tools::registry::ToolRegistryBuilder;
        use crate::tools::spec::ToolContext;
        use tempfile::tempdir;

        let tmp = tempdir().expect("tempdir");
        let ctx = ToolContext::new(tmp.path().to_path_buf());
        let registry = ToolRegistryBuilder::new()
            .with_agent_tools(false)
            .build(ctx);

        let tools = registry.all();
        let mut entries: Vec<(String, StrictClassification)> = tools
            .iter()
            .map(|tool| {
                let schema = tool.input_schema();
                let class = classify(&schema);
                (tool.name().to_string(), class)
            })
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));

        println!("\n=== Strict-Mode Classification Table ===");
        println!("{:<40} {:?}", "Tool", "Classification");
        println!("{}", "-".repeat(65));

        let mut compatible = 0u32;
        let mut needs_adapter = 0u32;
        let mut incompatible = 0u32;

        for (name, class) in &entries {
            println!("{:<40} {:?}", name, class);
            match class {
                StrictClassification::Compatible => compatible += 1,
                StrictClassification::NeedsAdapter => needs_adapter += 1,
                StrictClassification::Incompatible => incompatible += 1,
            }
        }

        println!("\n--- Summary ---");
        println!("Total:              {}", entries.len());
        println!("Compatible:   {}", compatible);
        println!("NeedsAdapter: {}", needs_adapter);
        println!("Incompatible: {}", incompatible);
        let adaptable_pct = ((compatible + needs_adapter) as f64 / entries.len() as f64) * 100.0;
        println!("Adaptable rate:     {:.0}%", adaptable_pct);

        // Write full table to a known file so the parent can read it
        let out_path = std::path::PathBuf::from("/tmp/strict_classification_table.txt");
        let mut out = String::new();
        out.push_str("Tool,Classification\n");
        for (name, class) in &entries {
            out.push_str(&format!("{},{:?}\n", name, class));
        }
        out.push_str(&format!("\nTotal,{}\n", entries.len()));
        out.push_str(&format!("Compatible,{}\n", compatible));
        out.push_str(&format!("NeedsAdapter,{}\n", needs_adapter));
        out.push_str(&format!("Incompatible,{}\n", incompatible));
        out.push_str(&format!("AdaptablePct,{:.0}\n", adaptable_pct));
        std::fs::write(&out_path, out).expect("write classification table");
        println!("Wrote classification table to {}", out_path.display());
    }
}
