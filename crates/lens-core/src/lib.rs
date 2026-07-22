pub mod arrow_stream;
pub mod verification;
pub const ENGINE_NAME: &str = "lens-core";

#[cfg(test)]
mod tests {
    use super::ENGINE_NAME;

    #[test]
    fn exposes_the_engine_name() {
        assert_eq!(ENGINE_NAME, "lens-core");
    }
}
