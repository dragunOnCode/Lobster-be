--
-- PostgreSQL database dump
--

\restrict jkDGPNYipP7x7dlMRgLiMc30s48hbU3AcfpWfiXGfdkzsgPbXIFHbQIJSDx6rTb

-- Dumped from database version 16.12 (Debian 16.12-1.pgdg12+1)
-- Dumped by pg_dump version 16.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- PostgreSQL database dump complete
--

\unrestrict jkDGPNYipP7x7dlMRgLiMc30s48hbU3AcfpWfiXGfdkzsgPbXIFHbQIJSDx6rTb

