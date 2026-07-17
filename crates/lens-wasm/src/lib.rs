#[must_use]
pub const fn engine_name() -> &'static str {
    lens_core::ENGINE_NAME
}

#[cfg(test)]
mod tests {
    use super::engine_name;

    #[test]
    fn links_the_shared_engine() {
        assert_eq!(engine_name(), "lens-core");
    }
}
